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
  settings?: { tts_speak_mode?: unknown } | Record<string, unknown> | null,
): TtsSpeakMode {
  if (!settings || typeof settings !== "object") return DEFAULT_TTS_SPEAK_MODE;
  const raw =
    "tts_speak_mode" in settings
      ? settings.tts_speak_mode
      : (settings as Record<string, unknown>)[TTS_SPEAK_MODE_KEY];
  return parseTtsSpeakMode(raw) || DEFAULT_TTS_SPEAK_MODE;
}

export function resolveEffectiveTtsSpeakMode(opts: {
  presenceSettings?: Record<string, unknown> | null;
  workspaceMode?: TtsSpeakMode | null;
}): TtsSpeakMode {
  return (
    presenceTtsSpeakMode(opts.presenceSettings) ||
    opts.workspaceMode ||
    DEFAULT_TTS_SPEAK_MODE
  );
}

export function serializePresenceTtsSpeakMode(
  mode: TtsSpeakModeOverride,
): Record<string, unknown> {
  return { [TTS_SPEAK_MODE_KEY]: mode };
}

export function readPresenceTtsSpeakModeOverride(
  settings?: Record<string, unknown> | null,
): TtsSpeakModeOverride {
  if (!settings || typeof settings !== "object") return "inherit";
  return parseTtsSpeakModeOverride(settings[TTS_SPEAK_MODE_KEY]) || "inherit";
}

/** Longest common prefix length — used to recover TTS cursors when sanitization shortens text. */
export function longestCommonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}
