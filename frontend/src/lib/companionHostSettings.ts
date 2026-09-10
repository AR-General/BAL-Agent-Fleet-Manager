import type { CompanionHost } from "@openclaw/character-kit";
import { parseInteractionAckSettings } from "./interactionAckSettings";
import { walkTrailOptionsFromSettings } from "./walkTrailSettings";

const LOCO_NEARBY_KEY = "loco_nearby_radius_m";
const DEFAULT_LOCO_NEARBY = 8;

export type LocoSettingsHost = {
  setWalkTrailOptions: CompanionHost["setWalkTrailOptions"];
  setLocoNearbyRadius: CompanionHost["setLocoNearbyRadius"];
};

export function applyLocoSettings(
  host: LocoSettingsHost,
  settings?: Record<string, unknown> | null,
): void {
  host.setWalkTrailOptions(walkTrailOptionsFromSettings(settings));
  const raw = settings?.[LOCO_NEARBY_KEY];
  if (raw === undefined || raw === null) {
    host.setLocoNearbyRadius(DEFAULT_LOCO_NEARBY);
  } else {
    const n = Number(raw);
    host.setLocoNearbyRadius(Number.isFinite(n) ? Math.max(0, Math.min(50, n)) : DEFAULT_LOCO_NEARBY);
  }
}

export function applyCompanionHostSettings(
  host: CompanionHost,
  settings?: Record<string, unknown> | null,
): void {
  applyLocoSettings(host, settings);
  host.setInteractionAck(parseInteractionAckSettings(settings));
}
