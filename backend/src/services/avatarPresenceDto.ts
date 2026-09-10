import { log } from "../utils/logger.js";
import { incMetric } from "../utils/metrics.js";

export type AvatarPresenceRow = {
  vrmUrl: string | null;
  gestureManifestUrl: string | null;
  defaultMood: string | null;
  clothes: Record<string, unknown> | null;
  fishVoiceId: string | null;
  pointerLook: boolean | null;
  defaultModelId: string | null;
  settings: Record<string, unknown> | null;
};

export type AvatarPresenceClient = {
  slug: string;
  vrm_url: string | null;
  vrmUrl: string | null;
  gesture_manifest_url: string | null;
  default_mood: string | null;
  defaultMood: string | null;
  clothes: Record<string, unknown>;
  fish_voice_id: string | null;
  fishVoiceId: string | null;
  pointer_look: boolean;
  pointerLook: boolean;
  default_model_id: string | null;
  settings: Record<string, unknown>;
};

export function avatarPresenceToClient(
  slug: string,
  row: AvatarPresenceRow | null | undefined,
): AvatarPresenceClient | null {
  if (!row) return null;
  const clothes = row.clothes && typeof row.clothes === "object" ? row.clothes : {};
  const settings = row.settings && typeof row.settings === "object" ? row.settings : {};
  return {
    slug,
    vrm_url: row.vrmUrl,
    vrmUrl: row.vrmUrl,
    gesture_manifest_url: row.gestureManifestUrl,
    default_mood: row.defaultMood,
    defaultMood: row.defaultMood,
    clothes,
    fish_voice_id: row.fishVoiceId,
    fishVoiceId: row.fishVoiceId,
    pointer_look: row.pointerLook !== false,
    pointerLook: row.pointerLook !== false,
    default_model_id: row.defaultModelId,
    settings,
  };
}

export function avatarPresencePatchFromBody(body: {
  vrm_url?: string | null;
  gesture_manifest_url?: string | null;
  default_mood?: string | null;
  clothes?: Record<string, unknown>;
  fish_voice_id?: string | null;
  pointer_look?: boolean;
  default_model_id?: string | null;
  settings?: Record<string, unknown>;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.vrm_url !== undefined) patch.vrmUrl = body.vrm_url;
  if (body.gesture_manifest_url !== undefined) patch.gestureManifestUrl = body.gesture_manifest_url;
  if (body.default_mood !== undefined) patch.defaultMood = body.default_mood;
  if (body.clothes !== undefined) patch.clothes = body.clothes;
  if (body.fish_voice_id !== undefined) patch.fishVoiceId = body.fish_voice_id;
  if (body.pointer_look !== undefined) patch.pointerLook = body.pointer_look;
  if (body.default_model_id !== undefined) patch.defaultModelId = body.default_model_id;
  if (body.settings !== undefined) patch.settings = body.settings;
  return patch;
}

export function logAvatarPresenceWrite(opts: {
  slug: string;
  created: boolean;
  vrmUrl: string | null | undefined;
}): void {
  log.info({ slug: opts.slug, created: opts.created, vrmUrl: opts.vrmUrl || null }, "agent avatar presence saved");
  incMetric("oc_avatar_presence_write_total", "Per-agent avatar presence upserts");
}
