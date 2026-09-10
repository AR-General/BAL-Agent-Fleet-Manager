/**
 * Per-agent avatar snapshot (VRM, clothes, mood, voice). Keyed by instance slug
 * so DM and group chats share the same body. Survives refresh via localStorage
 * and is the client cache in front of GET /presence/:slug.
 */
import { persistableVrmUrl } from "./resolveStoredVrmUrl.ts";

export const AGENT_AVATAR_STORE_KEY = "oc-agent-avatar-v1";

export type AgentAvatarSnapshot = {
  vrm_url: string;
  default_mood: string;
  pointer_look: boolean;
  fish_voice_id: string;
  clothes: Record<string, unknown>;
  settings: Record<string, unknown>;
};

export type AgentAvatarStore = Record<string, AgentAvatarSnapshot>;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseAgentAvatarSnapshot(raw: unknown): AgentAvatarSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const vrm_url = persistableVrmUrl(
    typeof rec.vrm_url === "string" ? rec.vrm_url : typeof rec.vrmUrl === "string" ? rec.vrmUrl : "",
  );
  return {
    vrm_url,
    default_mood:
      typeof rec.default_mood === "string"
        ? rec.default_mood
        : typeof rec.defaultMood === "string"
          ? rec.defaultMood
          : "neutral",
    pointer_look: rec.pointer_look !== false && rec.pointerLook !== false,
    fish_voice_id:
      typeof rec.fish_voice_id === "string"
        ? rec.fish_voice_id
        : typeof rec.fishVoiceId === "string"
          ? rec.fishVoiceId
          : "",
    clothes: asRecord(rec.clothes),
    settings: asRecord(rec.settings),
  };
}

export function readAgentAvatarStore(storage: StorageLike | null = browserStorage()): AgentAvatarStore {
  if (!storage) return {};
  try {
    const raw = storage.getItem(AGENT_AVATAR_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: AgentAvatarStore = {};
    for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
      const key = slug.trim().toLowerCase();
      const snap = parseAgentAvatarSnapshot(value);
      if (!key || !snap) continue;
      out[key] = snap;
    }
    return out;
  } catch (err) {
    console.warn("[agent-avatar] load failed", err);
    return {};
  }
}

export function readAgentAvatar(
  slug: string,
  storage: StorageLike | null = browserStorage(),
): AgentAvatarSnapshot | null {
  const key = slug.trim().toLowerCase();
  if (!key) return null;
  return readAgentAvatarStore(storage)[key] || null;
}

export function writeAgentAvatar(
  slug: string,
  snapshot: AgentAvatarSnapshot,
  storage: StorageLike | null = browserStorage(),
): void {
  const key = slug.trim().toLowerCase();
  if (!key || !storage) return;
  const next = persistableVrmUrl(snapshot.vrm_url);
  const store = readAgentAvatarStore(storage);
  store[key] = { ...snapshot, vrm_url: next };
  try {
    storage.setItem(AGENT_AVATAR_STORE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn("[agent-avatar] save failed", slug, err);
  }
}
