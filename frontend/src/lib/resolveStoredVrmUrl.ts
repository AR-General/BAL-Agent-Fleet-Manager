/** Pick which VRM URL to load for an agent after refresh / chat switch. */

import { libraryVrmRef, parseLibraryVrmId } from "./vrmLibrary.ts";

export function persistableVrmUrl(url: string | null | undefined): string {
  const value = (url || "").trim();
  if (!value || value.startsWith("blob:")) return "";
  const id = parseLibraryVrmId(value);
  if (id) return libraryVrmRef(id);
  return value;
}

export function resolveStoredVrmUrl(opts: {
  storedUrl?: string | null;
  cachedUrl?: string | null;
  idbObjectUrl?: string | null;
  libraryObjectUrl?: string | null;
  fallback: string;
}): string {
  const stored = persistableVrmUrl(opts.storedUrl);
  const cached = persistableVrmUrl(opts.cachedUrl);
  const chosen = stored || cached;
  if (chosen.startsWith("idb://")) {
    return opts.idbObjectUrl || opts.fallback;
  }
  if (parseLibraryVrmId(chosen)) {
    return opts.libraryObjectUrl || opts.fallback;
  }
  if (chosen) return chosen;
  return opts.idbObjectUrl || opts.libraryObjectUrl || opts.fallback;
}
