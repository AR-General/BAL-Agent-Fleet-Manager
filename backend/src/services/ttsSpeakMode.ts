export type TtsSpeakMode = "auto" | "tool";
export type TtsSpeakModeOverride = "inherit" | TtsSpeakMode;

export const TTS_SPEAK_MODE_KEY = "tts_speak_mode";
export const DEFAULT_TTS_SPEAK_MODE: TtsSpeakMode = "tool";

export function parseTtsSpeakMode(raw: unknown): TtsSpeakMode | null {
  if (raw === "auto" || raw === "tool") return raw;
  return null;
}

export function parseTtsSpeakModeOverride(raw: unknown): TtsSpeakModeOverride | null {
  if (raw === "inherit" || raw === "auto" || raw === "tool") return raw;
  return null;
}

/** Presence settings override; unset / inherit → null (fall through to workspace). */
export function presenceTtsSpeakMode(
  settings?: Record<string, unknown> | null,
): TtsSpeakMode | null {
  if (!settings || typeof settings !== "object") return null;
  const parsed = parseTtsSpeakModeOverride(settings[TTS_SPEAK_MODE_KEY]);
  if (!parsed || parsed === "inherit") return null;
  return parsed;
}

export function workspaceTtsSpeakMode(
  settings?: Record<string, unknown> | null,
): TtsSpeakMode {
  if (!settings || typeof settings !== "object") return DEFAULT_TTS_SPEAK_MODE;
  return parseTtsSpeakMode(settings[TTS_SPEAK_MODE_KEY]) || DEFAULT_TTS_SPEAK_MODE;
}

export function resolveEffectiveTtsSpeakMode(opts: {
  presenceSettings?: Record<string, unknown> | null;
  workspaceSettings?: Record<string, unknown> | null;
}): TtsSpeakMode {
  return (
    presenceTtsSpeakMode(opts.presenceSettings) ||
    workspaceTtsSpeakMode(opts.workspaceSettings)
  );
}
