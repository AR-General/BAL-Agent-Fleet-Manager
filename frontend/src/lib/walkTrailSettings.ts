import {
  DEFAULT_WALK_TRAIL,
  normalizeWalkTrailOptions,
  type WalkTrailOptions,
} from "@openclaw/character-kit";

/** Presence `settings` keys for the walk trail. */
export const WALK_TRAIL_ENABLED_KEY = "walk_trail_enabled";
export const WALK_TRAIL_COLOR_KEY = "walk_trail_color";
export const WALK_TRAIL_DURATION_KEY = "walk_trail_duration_sec";

export type WalkTrailSettings = {
  enabled: boolean;
  color: string;
  durationSec: number;
};

function colorToCss(color: string | number): string {
  if (typeof color === "string" && color.trim().startsWith("#")) return color.trim();
  if (typeof color === "number" && Number.isFinite(color)) {
    return `#${(color >>> 0).toString(16).padStart(6, "0")}`;
  }
  return "#ffffff";
}

/** Defaults: enabled, white, 5 seconds. */
export function defaultWalkTrailSettings(): WalkTrailSettings {
  return {
    enabled: true,
    color: colorToCss(DEFAULT_WALK_TRAIL.color),
    durationSec: DEFAULT_WALK_TRAIL.durationSec,
  };
}

export function parseWalkTrailSettings(
  settings?: Record<string, unknown> | null,
): WalkTrailSettings {
  const defaults = defaultWalkTrailSettings();
  if (!settings || typeof settings !== "object") return defaults;

  const enabled =
    settings[WALK_TRAIL_ENABLED_KEY] === undefined
      ? defaults.enabled
      : Boolean(settings[WALK_TRAIL_ENABLED_KEY]);

  const colorRaw = settings[WALK_TRAIL_COLOR_KEY];
  const color =
    typeof colorRaw === "string" && colorRaw.trim()
      ? colorRaw.trim()
      : typeof colorRaw === "number"
        ? colorToCss(colorRaw)
        : defaults.color;

  const durationRaw = Number(settings[WALK_TRAIL_DURATION_KEY]);
  const durationSec =
    Number.isFinite(durationRaw) && durationRaw > 0
      ? Math.min(60, durationRaw)
      : defaults.durationSec;

  return { enabled, color, durationSec };
}

export function serializeWalkTrailSettings(trail: WalkTrailSettings): Record<string, unknown> {
  return {
    [WALK_TRAIL_ENABLED_KEY]: trail.enabled,
    [WALK_TRAIL_COLOR_KEY]: trail.color,
    [WALK_TRAIL_DURATION_KEY]: trail.durationSec,
  };
}

export function walkTrailOptionsFromSettings(
  settings?: Record<string, unknown> | null,
): WalkTrailOptions {
  const parsed = parseWalkTrailSettings(settings);
  return normalizeWalkTrailOptions({
    enabled: parsed.enabled,
    color: parsed.color,
    durationSec: parsed.durationSec,
  });
}
