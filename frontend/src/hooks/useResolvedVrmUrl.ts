import { useEffect, useMemo, useState } from "react";
import { apiBlob } from "../api/client";
import { libraryVrmFilePath, parseLibraryVrmId } from "../lib/vrmLibrary";
import { persistableVrmUrl } from "../lib/resolveStoredVrmUrl";

const blobCache = new Map<string, string>();

async function blobForLibraryId(id: string): Promise<string> {
  const cached = blobCache.get(id);
  if (cached) return cached;
  const blob = await apiBlob(libraryVrmFilePath(id));
  const url = URL.createObjectURL(blob);
  blobCache.set(id, url);
  return url;
}

/** Resolve `oc-vrm:` library refs to blob URLs so Three.js can load authenticated files. */
export function useResolvedVrmUrl(stored: string | null | undefined): string {
  const persistable = persistableVrmUrl(stored);
  const id = parseLibraryVrmId(persistable);
  const [blobUrl, setBlobUrl] = useState(() => (id ? blobCache.get(id) || "" : ""));

  useEffect(() => {
    if (!id) {
      setBlobUrl("");
      return;
    }
    let cancelled = false;
    void blobForLibraryId(id)
      .then((url) => {
        if (!cancelled) setBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (id) return blobUrl;
  return persistable;
}

export function useResolvedVrmMap(storedUrls: string[]): Record<string, string> {
  const key = storedUrls.map((u) => persistableVrmUrl(u)).join("|");
  const ids = useMemo(() => {
    const out: string[] = [];
    for (const u of storedUrls) {
      const id = parseLibraryVrmId(persistableVrmUrl(u));
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      ids.map(async (id) => {
        try {
          const url = await blobForLibraryId(id);
          return [id, url] as const;
        } catch {
          return [id, ""] as const;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, url] of pairs) next[id] = url;
      setMap(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ids]);

  const resolved: Record<string, string> = {};
  for (const stored of storedUrls) {
    const persistable = persistableVrmUrl(stored) || stored;
    const id = parseLibraryVrmId(persistable);
    resolved[stored] = id ? map[id] || "" : persistable;
    if (persistable !== stored) resolved[persistable] = resolved[stored];
  }
  return resolved;
}

