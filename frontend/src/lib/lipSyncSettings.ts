/** Presence `settings` key: mouth visemes follow TTS audio. Default on. */
export const LIP_SYNC_ENABLED_KEY = "lip_sync_enabled";

export function isLipSyncEnabled(settings?: Record<string, unknown> | null): boolean {
  if (!settings || typeof settings !== "object") return true;
  const raw = settings[LIP_SYNC_ENABLED_KEY];
  if (raw === undefined || raw === null) return true;
  return Boolean(raw);
}

export function serializeLipSyncSettings(enabled: boolean): Record<string, unknown> {
  return { [LIP_SYNC_ENABLED_KEY]: enabled !== false };
}
