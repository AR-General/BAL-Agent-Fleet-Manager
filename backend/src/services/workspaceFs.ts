import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { config } from "../config.js";

export class WorkspaceUnavailableError extends Error {
  status = 503;
  constructor(message = "workspace root unavailable") {
    super(message);
    this.name = "WorkspaceUnavailableError";
  }
}

export class WorkspacePathError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

function rootDir(): string {
  const root = (config.workspaceRoot || "").trim();
  if (!root) throw new WorkspaceUnavailableError("OC_WORKSPACE_ROOT not configured");
  const abs = path.resolve(root);
  if (!fsSync.existsSync(abs)) {
    throw new WorkspaceUnavailableError(`workspace root missing: ${abs}`);
  }
  return abs;
}

/** Resolve and sandbox a relative workspace path. */
export function resolveWorkspacePath(rel: string): string {
  const root = rootDir();
  const cleaned = rel.replace(/^\/+/, "").replace(/\0/g, "");
  const full = path.resolve(root, cleaned);
  const relToRoot = path.relative(root, full);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new WorkspacePathError("path escapes workspace root");
  }
  return full;
}

export async function listWorkspace(rel = ""): Promise<
  Array<{ name: string; path: string; type: "file" | "dir"; size?: number; mtimeMs?: number }>
> {
  const dir = resolveWorkspacePath(rel || ".");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = path.join(rel || "", e.name).replace(/\\/g, "/");
    const full = path.join(dir, e.name);
    const st = await fs.stat(full);
    out.push({
      name: e.name,
      path: p,
      type: e.isDirectory() ? ("dir" as const) : ("file" as const),
      size: e.isFile() ? st.size : undefined,
      mtimeMs: st.mtimeMs,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readWorkspaceFile(rel: string): Promise<{
  content: string;
  etag: string;
  mtimeMs: number;
  path: string;
}> {
  const full = resolveWorkspacePath(rel);
  const st = await fs.stat(full);
  if (!st.isFile()) throw new WorkspacePathError("not a file");
  const content = await fs.readFile(full, "utf8");
  const etag = `"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`;
  return { content, etag, mtimeMs: st.mtimeMs, path: rel };
}

export async function writeWorkspaceFile(
  rel: string,
  content: string,
  ifMatch?: string,
): Promise<{ etag: string; mtimeMs: number }> {
  const full = resolveWorkspacePath(rel);
  if (fsSync.existsSync(full)) {
    const st = await fs.stat(full);
    const etag = `"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`;
    if (ifMatch && ifMatch !== etag) {
      const err = new WorkspacePathError("etag mismatch — file changed on server");
      (err as WorkspacePathError & { status: number }).status = 409;
      throw err;
    }
  }
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
  const st = await fs.stat(full);
  return {
    etag: `"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`,
    mtimeMs: st.mtimeMs,
  };
}

type WatchCb = (rel: string) => void;
const watchers = new Map<string, fsSync.FSWatcher>();

export function watchWorkspace(rel: string, cb: WatchCb): () => void {
  let full: string;
  try {
    full = resolveWorkspacePath(rel || ".");
  } catch {
    return () => undefined;
  }
  const key = full;
  if (watchers.has(key)) {
    watchers.get(key)!.close();
  }
  const w = fsSync.watch(full, { recursive: true }, (_event, filename) => {
    if (filename) cb(path.join(rel || "", filename).replace(/\\/g, "/"));
  });
  watchers.set(key, w);
  return () => {
    w.close();
    watchers.delete(key);
  };
}
