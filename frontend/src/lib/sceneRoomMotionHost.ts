import type {
  CharacterActionSource,
  SceneRoomAvatarHandle,
} from "@openclaw/character-kit";

/** CompanionHost-shaped adapter so shared-scene occupants reuse DM motion hooks. */
export function sceneRoomMotionHost(handle: SceneRoomAvatarHandle) {
  return {
    playGesture(
      id: string,
      loop = false,
      source: CharacterActionSource = "user",
      detail = "config",
      timeScale?: number,
      sceneTarget?: string,
    ) {
      const result = handle.controller.playGesture(id, loop, 0.25, timeScale, source, sceneTarget);
      if (result === "skipped") return;
      handle.director.pushAction("gesture", loop ? `${id} · loop` : id, source, detail, sceneTarget, {
        durationMs: handle.controller.gesturePlaybackMs(id, { loop, timeScale }) ?? undefined,
        loop,
        timeScale,
      });
    },
    setMood(mood: string, source: CharacterActionSource = "user", detail = "config") {
      const ok = handle.director.getPresence().setMood(mood);
      if (ok) handle.director.pushAction("mood", mood, source, detail);
      return ok;
    },
    pausePresence(reason = "agent_status") {
      handle.director.pausePresence(reason);
    },
    resumePresence() {
      handle.director.resumePresence();
    },
  };
}
