/**
 * Per-conversation shared-scene XZ poses. Survives refresh even when the
 * in-memory backend viewport row is gone.
 */
import type { SceneOccupantPose } from "@openclaw/character-kit";

export const SCENE_POSE_STORAGE_PREFIX = "oc-chat-scene-poses:";

const MAX_OCCUPANTS = 32;

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function scenePoseStorageKey(sessionId: string): string {
  return `${SCENE_POSE_STORAGE_PREFIX}${sessionId}`;
}

export function parseScenePoses(raw: unknown): SceneOccupantPose[] {
  if (!Array.isArray(raw)) return [];
  const out: SceneOccupantPose[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, MAX_OCCUPANTS)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const slug = String(rec.slug || rec.id || "").trim();
    if (!slug || seen.has(slug.toLowerCase())) continue;
    seen.add(slug.toLowerCase());
    const x = Number(rec.x);
    const z = Number(rec.z);
    const facing = Number(rec.facing);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(facing)) continue;
    out.push({
      slug,
      x,
      z,
      facing,
      present: rec.present !== false,
    });
  }
  return out;
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadScenePoses(sessionId: string, storage: StorageLike | null = browserStorage()): SceneOccupantPose[] {
  if (!sessionId || !storage) return [];
  try {
    const raw = storage.getItem(scenePoseStorageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const occupants =
      parsed && typeof parsed === "object" && parsed !== null && "occupants" in parsed
        ? (parsed as { occupants: unknown }).occupants
        : parsed;
    const poses = parseScenePoses(occupants);
    return poses;
  } catch (err) {
    console.warn("[scene-poses] load failed", sessionId, err);
    return [];
  }
}

export function saveScenePoses(
  sessionId: string,
  poses: SceneOccupantPose[],
  storage: StorageLike | null = browserStorage(),
): void {
  if (!sessionId || !storage) return;
  const occupants = parseScenePoses(poses);
  try {
    storage.setItem(scenePoseStorageKey(sessionId), JSON.stringify({ v: 1, occupants }));
  } catch (err) {
    console.warn("[scene-poses] save failed", sessionId, err);
  }
}
