import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { vrmModels } from "../db/schema.js";
import { log } from "../utils/logger.js";
import { incMetric, setGauge } from "../utils/metrics.js";
import {
  assertSafeRelativePath,
  displayNameFromFilename,
  isGltfBinary,
  isVrmFilename,
  libraryVrmRef,
  resolveContainedPath,
  sanitizeUploadFilename,
  type VrmSource,
} from "./vrmPaths.js";

export type VrmModelDto = {
  id: string;
  name: string;
  description: string | null;
  source: VrmSource;
  relative_path: string | null;
  original_filename: string | null;
  file_size: number | null;
  sha256: string | null;
  hidden: boolean;
  missing: boolean;
  preview_url: string;
  created_at: string;
  updated_at: string;
};

const MAX_SCAN_DEPTH = 4;

function absDir(dir: string): string {
  return path.resolve(dir);
}

export function toVrmModelDto(
  row: typeof vrmModels.$inferSelect,
  opts?: { missing?: boolean },
): VrmModelDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source === "directory" ? "directory" : "upload",
    relative_path: row.relativePath,
    original_filename: row.originalFilename,
    file_size: row.fileSize,
    sha256: row.sha256,
    hidden: row.hidden,
    missing: Boolean(opts?.missing),
    preview_url: libraryVrmRef(row.id),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function walkVrmFiles(root: string, relDir: string, depth: number): Promise<string[]> {
  if (depth > MAX_SCAN_DEPTH) return [];
  const abs = relDir ? resolveContainedPath(root, relDir) : absDir(root);
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walkVrmFiles(root, rel, depth + 1)));
      continue;
    }
    if (entry.isFile() && isVrmFilename(entry.name)) {
      out.push(assertSafeRelativePath(rel));
    }
  }
  return out;
}

export async function resolveVrmFilePath(
  tenantId: string,
  id: string,
): Promise<{ absPath: string; filename: string; mime: string } | null> {
  const db = getDb();
  const row = await db.query.vrmModels.findFirst({
    where: and(eq(vrmModels.id, id), eq(vrmModels.tenantId, tenantId)),
  });
  if (!row) return null;
  const filename = row.originalFilename || `${row.name}.vrm`;
  if (row.source === "directory") {
    if (!row.relativePath) return null;
    const absPath = resolveContainedPath(config.vrmLibraryDir, row.relativePath);
    try {
      await fs.access(absPath);
    } catch {
      return null;
    }
    return { absPath, filename, mime: "model/gltf-binary" };
  }
  if (!row.storageKey) return null;
  const absPath = resolveContainedPath(config.vrmUploadDir, row.storageKey);
  try {
    await fs.access(absPath);
  } catch {
    return null;
  }
  return { absPath, filename, mime: "model/gltf-binary" };
}

export async function syncDirectoryModels(tenantId: string): Promise<number> {
  const root = absDir(config.vrmLibraryDir);
  await ensureDir(root);
  const files = await walkVrmFiles(root, "", 0);
  const db = getDb();
  let created = 0;
  for (const rel of files) {
    const existing = await db.query.vrmModels.findFirst({
      where: and(
        eq(vrmModels.tenantId, tenantId),
        eq(vrmModels.source, "directory"),
        eq(vrmModels.relativePath, rel),
      ),
    });
    if (existing) {
      const st = await fs.stat(resolveContainedPath(root, rel));
      if (existing.fileSize !== st.size) {
        await db
          .update(vrmModels)
          .set({ fileSize: st.size, updatedAt: new Date() })
          .where(eq(vrmModels.id, existing.id));
      }
      continue;
    }
    const st = await fs.stat(resolveContainedPath(root, rel));
    await db.insert(vrmModels).values({
      tenantId,
      name: displayNameFromFilename(rel),
      source: "directory",
      relativePath: rel,
      originalFilename: path.basename(rel),
      fileSize: st.size,
      hidden: false,
    });
    created += 1;
  }
  if (created > 0) {
    log.info({ tenantId, created, scanned: files.length }, "vrm directory scan inserted models");
  }
  return created;
}

export async function listVrmModels(
  tenantId: string,
  opts?: { includeHidden?: boolean },
): Promise<VrmModelDto[]> {
  await syncDirectoryModels(tenantId);
  const db = getDb();
  const rows = await db.select().from(vrmModels).where(eq(vrmModels.tenantId, tenantId));
  const dtos: VrmModelDto[] = [];
  for (const row of rows) {
    if (!opts?.includeHidden && row.hidden) continue;
    const resolved = await resolveVrmFilePath(tenantId, row.id);
    dtos.push(toVrmModelDto(row, { missing: !resolved }));
  }
  dtos.sort((a, b) => a.name.localeCompare(b.name));
  setGauge("oc_vrm_library_models", "VRM models visible for the last listing tenant", dtos.length);
  return dtos;
}

export async function getVrmModel(tenantId: string, id: string): Promise<VrmModelDto | null> {
  const db = getDb();
  const row = await db.query.vrmModels.findFirst({
    where: and(eq(vrmModels.id, id), eq(vrmModels.tenantId, tenantId)),
  });
  if (!row) return null;
  const resolved = await resolveVrmFilePath(tenantId, id);
  return toVrmModelDto(row, { missing: !resolved });
}

export async function uploadVrmModel(opts: {
  tenantId: string;
  buffer: Buffer;
  filename: string;
  name?: string;
  description?: string;
}): Promise<VrmModelDto> {
  const max = config.vrmMaxBytes;
  if (opts.buffer.length === 0) {
    throw Object.assign(new Error("empty file"), { status: 400 });
  }
  if (opts.buffer.length > max) {
    throw Object.assign(new Error(`file exceeds ${max} bytes`), { status: 413 });
  }
  if (!isGltfBinary(opts.buffer)) {
    throw Object.assign(new Error("not a glTF/VRM binary (missing glTF magic)"), { status: 400 });
  }
  const originalFilename = sanitizeUploadFilename(opts.filename);
  const id = randomUUID();
  const storageKey = `${id}.vrm`;
  const uploadRoot = absDir(config.vrmUploadDir);
  await ensureDir(uploadRoot);
  const absPath = resolveContainedPath(uploadRoot, storageKey);
  const sha256 = createHash("sha256").update(opts.buffer).digest("hex");
  await fs.writeFile(absPath, opts.buffer);
  const db = getDb();
  try {
    const [row] = await db
      .insert(vrmModels)
      .values({
        id,
        tenantId: opts.tenantId,
        name: (opts.name || "").trim() || displayNameFromFilename(originalFilename),
        description: opts.description?.trim() || null,
        source: "upload",
        storageKey,
        originalFilename,
        fileSize: opts.buffer.length,
        sha256,
        hidden: false,
      })
      .returning();
    incMetric("oc_vrm_uploads_total", "VRM files uploaded to the tenant library");
    log.info(
      { tenantId: opts.tenantId, id, bytes: opts.buffer.length, filename: originalFilename },
      "vrm model uploaded",
    );
    return toVrmModelDto(row, { missing: false });
  } catch (err) {
    await fs.unlink(absPath).catch(() => undefined);
    throw err;
  }
}

export async function updateVrmModel(
  tenantId: string,
  id: string,
  patch: { name?: string; description?: string | null; hidden?: boolean },
): Promise<VrmModelDto | null> {
  const db = getDb();
  const existing = await db.query.vrmModels.findFirst({
    where: and(eq(vrmModels.id, id), eq(vrmModels.tenantId, tenantId)),
  });
  if (!existing) return null;
  const next: Partial<typeof vrmModels.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw Object.assign(new Error("name required"), { status: 400 });
    next.name = name;
  }
  if (patch.description !== undefined) {
    next.description = patch.description?.trim() || null;
  }
  if (patch.hidden !== undefined) next.hidden = patch.hidden;
  const [row] = await db
    .update(vrmModels)
    .set(next)
    .where(eq(vrmModels.id, id))
    .returning();
  log.info({ tenantId, id, fields: Object.keys(patch) }, "vrm model updated");
  const resolved = await resolveVrmFilePath(tenantId, id);
  return toVrmModelDto(row, { missing: !resolved });
}

export async function deleteVrmModel(tenantId: string, id: string): Promise<"deleted" | "hidden" | null> {
  const db = getDb();
  const row = await db.query.vrmModels.findFirst({
    where: and(eq(vrmModels.id, id), eq(vrmModels.tenantId, tenantId)),
  });
  if (!row) return null;
  if (row.source === "directory") {
    await db.update(vrmModels).set({ hidden: true, updatedAt: new Date() }).where(eq(vrmModels.id, id));
    log.info({ tenantId, id, relativePath: row.relativePath }, "vrm directory model hidden (file kept on disk)");
    return "hidden";
  }
  if (row.storageKey) {
    const absPath = resolveContainedPath(config.vrmUploadDir, row.storageKey);
    await fs.unlink(absPath).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    });
  }
  await db.delete(vrmModels).where(eq(vrmModels.id, id));
  incMetric("oc_vrm_deletes_total", "Uploaded VRM files deleted from the tenant library");
  log.info({ tenantId, id }, "vrm upload deleted");
  return "deleted";
}
