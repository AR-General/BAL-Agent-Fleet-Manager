import { useEffect, useRef, useState } from "react";
import type { CompanionHost } from "@openclaw/character-kit";

type PlayableHost = Pick<CompanionHost, "playInlineTags">;

type Args = {
  host: PlayableHost | null;
  /** Stable id for the completed assistant message (dedupe). */
  performanceKey?: string | null;
  /** Full assistant message text including `[walk:…]` cues. */
  performanceText?: string | null;
  enabled?: boolean;
  /**
   * When TTS is speaking, only run locomotion cues here — face/emotion cues are
   * scheduled against Fish word timestamps by the voice dock.
   */
  ttsEnabled?: boolean;
  onMood?: (mood: string) => void;
};

/**
 * When a finished assistant message arrives, parse inline character tags and
 * run them on the companion (walk / mood / gestures), matching the playground.
 *
 * Dedupes by message id only after a successful run on the current host so
 * React Strict Mode remounts (dispose → new CompanionHost) still play once.
 */
export function useInlineTagPerformance({
  host,
  performanceKey,
  performanceText,
  enabled = true,
  ttsEnabled = false,
  onMood,
}: Args): boolean {
  const playedRef = useRef<{ key: string; host: PlayableHost | null }>({
    key: "",
    host: null,
  });
  const [performing, setPerforming] = useState(false);

  useEffect(() => {
    if (!enabled || !host) return;
    const key = (performanceKey || "").trim();
    const text = typeof performanceText === "string" ? performanceText : "";
    if (!key || !text.trim()) return;
    if (playedRef.current.key === key && playedRef.current.host === host) return;

    let alive = true;
    setPerforming(true);

    void (async () => {
      try {
        const parsed = await host.playInlineTags(text, {
          locomotionOnly: ttsEnabled,
        });
        if (!alive) return;
        playedRef.current = { key, host };
        const moodStep = [...parsed.withSpeech, ...parsed.afterTts].find(
          (s) => s.op === "set_mood" && typeof s.mood === "string",
        );
        if (moodStep?.mood && !ttsEnabled) onMood?.(moodStep.mood);
        if (parsed.withSpeech.length || parsed.afterTts.length || parsed.timedCues?.length) {
          console.info("[inline-tags] performed", {
            key,
            ttsEnabled,
            locomotionOnly: ttsEnabled,
            withSpeech: parsed.withSpeech.length,
            afterTts: parsed.afterTts.length,
            timedCues: parsed.timedCues?.length ?? 0,
            badges: parsed.badges.map((b) => b.raw),
          });
        } else {
          console.info("[inline-tags] no character steps in message", { key });
        }
      } catch (err) {
        console.warn("[inline-tags] performance failed", err);
      } finally {
        if (alive) setPerforming(false);
      }
    })();

    return () => {
      alive = false;
      setPerforming(false);
    };
  }, [enabled, host, onMood, performanceKey, performanceText, ttsEnabled]);

  return performing;
}
