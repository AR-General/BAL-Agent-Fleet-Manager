/** Same-origin pop-out of the live 3D scene while chat stays in the original window. */

export const SCENE_POPOUT_CHANNEL = "oc-chat-scene-popout";
export const SCENE_POPOUT_NAME_PREFIX = "oc-scene-";

export type ScenePopoutRole = "chat" | "scene";

export type ScenePopoutMessage =
  | { type: "ping"; sessionId: string }
  | { type: "opened"; sessionId: string }
  | { type: "closed"; sessionId: string }
  | { type: "restore"; sessionId: string }
  | { type: "look-at"; sessionId: string; slug: string; token: number }
  | { type: "config"; sessionId: string; slug: string; token: number }
  | { type: "transcript"; sessionId: string; text: string }
  | { type: "tts-cancel-current"; sessionId: string }
  | { type: "tts-cancel-queue"; sessionId: string }
  | {
      type: "tts-queue";
      sessionId: string;
      speaking: boolean;
      speakingSlug: string | null;
      queueLength: number;
    };

export function scenePopoutPath(sessionId: string): string {
  return `/chat/${sessionId}/scene`;
}

export function scenePopoutWindowName(sessionId: string): string {
  return `${SCENE_POPOUT_NAME_PREFIX}${sessionId}`;
}

export function isScenePopoutPath(pathname: string): boolean {
  return /\/chat\/[^/]+\/scene\/?$/.test(pathname);
}

export function scenePopoutUrl(sessionId: string, origin = globalThis.location?.origin || ""): string {
  return `${origin}${scenePopoutPath(sessionId)}`;
}

export function parseScenePopoutMessage(raw: unknown): ScenePopoutMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const sessionId = String(rec.sessionId || "").trim();
  const type = String(rec.type || "");
  if (!sessionId || !type) return null;
  if (
    type === "ping" ||
    type === "opened" ||
    type === "closed" ||
    type === "restore" ||
    type === "tts-cancel-current" ||
    type === "tts-cancel-queue"
  ) {
    return { type, sessionId };
  }
  if (type === "look-at" || type === "config") {
    const slug = String(rec.slug || "").trim();
    const token = Number(rec.token);
    if (!slug || !Number.isFinite(token)) return null;
    return { type, sessionId, slug, token };
  }
  if (type === "transcript") {
    return { type, sessionId, text: String(rec.text ?? "") };
  }
  if (type === "tts-queue") {
    return {
      type,
      sessionId,
      speaking: rec.speaking === true,
      speakingSlug: rec.speakingSlug ? String(rec.speakingSlug) : null,
      queueLength: Number.isFinite(Number(rec.queueLength)) ? Number(rec.queueLength) : 0,
    };
  }
  return null;
}
