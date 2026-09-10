import path from "node:path";

export const VRM_GLTF_MAGIC = Buffer.from("glTF");
export const VRM_LIBRARY_REF_PREFIX = "oc-vrm:";

export type VrmSource = "directory" | "upload";

export function isVrmFilename(name: string): boolean {
  return /\.vrm$/i.test(name.trim());
}

export function displayNameFromFilename(filename: string): string {
  const base = path.basename(filename).replace(/\.vrm$/i, "");
  const spaced = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return "Untitled VRM";
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sanitizeUploadFilename(raw: string): string {
  const base = path.basename(String(raw || "").replace(/\\/g, "/")).trim();
  if (!base || base === "." || base === "..") {
    throw new Error("filename required");
  }
  if (!isVrmFilename(base)) {
    throw new Error("file must have a .vrm extension");
  }
  return base;
}

/** POSIX relative path inside the library dir; rejects traversal. */
export function assertSafeRelativePath(rel: string): string {
  const normalized = path.posix.normalize(rel.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("invalid relative path");
  }
  if (normalized.split("/").some((p) => p === ".." || p === "")) {
    throw new Error("invalid relative path");
  }
  return normalized;
}

export function resolveContainedPath(rootDir: string, rel: string): string {
  const safeRel = assertSafeRelativePath(rel);
  const root = path.resolve(rootDir);
  const abs = path.resolve(root, ...safeRel.split("/"));
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (abs !== root && !abs.startsWith(prefix)) {
    throw new Error("path escapes library root");
  }
  return abs;
}

export function isGltfBinary(buf: Buffer): boolean {
  return buf.length >= 12 && buf.subarray(0, 4).equals(VRM_GLTF_MAGIC);
}

export function parseLibraryVrmId(url: string): string | null {
  const value = (url || "").trim();
  const prefixed = value.match(new RegExp(`^${VRM_LIBRARY_REF_PREFIX}([0-9a-f-]{36})$`, "i"));
  if (prefixed) return prefixed[1]!.toLowerCase();
  const fromPath = value.match(/\/vrm-models\/([0-9a-f-]{36})(?:\/file)?(?:\?.*)?$/i);
  return fromPath ? fromPath[1]!.toLowerCase() : null;
}

export function libraryVrmRef(id: string): string {
  return `${VRM_LIBRARY_REF_PREFIX}${id}`;
}
