export const VRM_LIBRARY_REF_PREFIX = "oc-vrm:";

export type VrmSource = "directory" | "upload";

export type VrmModel = {
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

export function libraryVrmRef(id: string): string {
  return `${VRM_LIBRARY_REF_PREFIX}${id}`;
}

export function parseLibraryVrmId(url: string | null | undefined): string | null {
  const value = (url || "").trim();
  const prefixed = value.match(/^oc-vrm:([0-9a-f-]{36})$/i);
  if (prefixed) return prefixed[1]!.toLowerCase();
  const fromPath = value.match(/\/vrm-models\/([0-9a-f-]{36})(?:\/file)?(?:\?.*)?$/i);
  return fromPath ? fromPath[1]!.toLowerCase() : null;
}

export function libraryVrmFilePath(id: string): string {
  return `/vrm-models/${id}/file`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
