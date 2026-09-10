/** Presence `settings` keys for click-nod / zoom-wave acks. Defaults match character-kit InteractionAck. */
export const CLICK_ACK_ENABLED_KEY = "click_ack_enabled";
export const CLICK_ACK_GESTURE_KEY = "click_ack_gesture";
export const CLICK_ACK_SPEED_KEY = "click_ack_speed";
export const ZOOM_ACK_ENABLED_KEY = "zoom_ack_enabled";
export const ZOOM_IN_GESTURE_KEY = "zoom_in_gesture";
export const ZOOM_OUT_GESTURE_KEY = "zoom_out_gesture";

const DEFAULT_CLICK_GESTURE = "nod";
const DEFAULT_ZOOM_IN = "v_sign";
const DEFAULT_ZOOM_OUT = "wave";
const DEFAULT_CLICK_SPEED = 0.7;

export type InteractionAckSettings = {
  clickEnabled: boolean;
  clickGesture: string;
  clickSpeed: number;
  zoomEnabled: boolean;
  zoomInGesture: string;
  zoomOutGesture: string;
};

function gestureId(raw: unknown, fallback: string): string {
  const id = typeof raw === "string" ? raw.trim() : "";
  return id || fallback;
}

function clampSpeed(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_CLICK_SPEED;
  return Math.min(3, Math.max(0.35, n));
}

export function parseInteractionAckSettings(
  settings?: Record<string, unknown> | null,
): InteractionAckSettings {
  if (!settings || typeof settings !== "object") {
    return {
      clickEnabled: true,
      clickGesture: DEFAULT_CLICK_GESTURE,
      clickSpeed: DEFAULT_CLICK_SPEED,
      zoomEnabled: true,
      zoomInGesture: DEFAULT_ZOOM_IN,
      zoomOutGesture: DEFAULT_ZOOM_OUT,
    };
  }
  return {
    clickEnabled:
      settings[CLICK_ACK_ENABLED_KEY] === undefined
        ? true
        : Boolean(settings[CLICK_ACK_ENABLED_KEY]),
    clickGesture: gestureId(settings[CLICK_ACK_GESTURE_KEY], DEFAULT_CLICK_GESTURE),
    clickSpeed: clampSpeed(settings[CLICK_ACK_SPEED_KEY]),
    zoomEnabled:
      settings[ZOOM_ACK_ENABLED_KEY] === undefined
        ? true
        : Boolean(settings[ZOOM_ACK_ENABLED_KEY]),
    zoomInGesture: gestureId(settings[ZOOM_IN_GESTURE_KEY], DEFAULT_ZOOM_IN),
    zoomOutGesture: gestureId(settings[ZOOM_OUT_GESTURE_KEY], DEFAULT_ZOOM_OUT),
  };
}

export function serializeInteractionAckSettings(
  ack: InteractionAckSettings,
): Record<string, unknown> {
  return {
    [CLICK_ACK_ENABLED_KEY]: ack.clickEnabled !== false,
    [CLICK_ACK_GESTURE_KEY]: gestureId(ack.clickGesture, DEFAULT_CLICK_GESTURE),
    [CLICK_ACK_SPEED_KEY]: clampSpeed(ack.clickSpeed),
    [ZOOM_ACK_ENABLED_KEY]: ack.zoomEnabled !== false,
    [ZOOM_IN_GESTURE_KEY]: gestureId(ack.zoomInGesture, DEFAULT_ZOOM_IN),
    [ZOOM_OUT_GESTURE_KEY]: gestureId(ack.zoomOutGesture, DEFAULT_ZOOM_OUT),
  };
}
