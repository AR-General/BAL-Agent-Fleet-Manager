import { useEffect, useRef } from "react";
import type { CompanionHost } from "@nexus/character-kit";
import {
  coalesceAgentStatusPhase,
  isLiveAgentState,
  motionsForState,
  pickStatusGesture,
  statusMood,
  type AgentLiveStatus,
  type StatusMotionMap,
} from "../lib/agentStatusGestures";

type PlayableHost = Pick<CompanionHost, "playGesture" | "setMood" | "pausePresence" | "resumePresence">;

type Args = {
  host: PlayableHost | null;
  agentStatus?: AgentLiveStatus | null;
  motions: StatusMotionMap;
  enabled?: boolean;
  focusedSlug?: string;
  onMood?: (mood: string) => void;
};

/** Min gap between status gesture plays (avoids storm when WS status flips). */
const STATUS_GESTURE_COOLDOWN_MS = 2800;

/**
 * While the agent is thinking/writing, pause idle presence and cycle
 * configured gestures. Coalesces planning/reading/running into one phase so
 * Hermes tool_progress floods do not restart the loop every tick.
 */
export function useAgentStatusMotions({
  host,
  agentStatus,
  motions,
  enabled = true,
  focusedSlug,
  onMood,
}: Args): void {
  const lastGestureRef = useRef<string | null>(null);
  const lastMoodRef = useRef<string | null>(null);
  const lastPlayAtRef = useRef(0);
  const pausedRef = useRef(false);
  const phaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !host || !agentStatus?.state) return;
    const slug = agentStatus.authorSlug;
    if (slug && focusedSlug && slug !== focusedSlug) return;

    const phase = coalesceAgentStatusPhase(agentStatus.state);
    const live = isLiveAgentState(phase);
    const nextMood = statusMood(phase);

    if (lastMoodRef.current !== nextMood) {
      const applied = host.setMood(nextMood, "agent", "status");
      if (applied) {
        lastMoodRef.current = nextMood;
        onMood?.(nextMood);
      }
    }

    if (!live) {
      if (pausedRef.current) {
        host.resumePresence();
        pausedRef.current = false;
      }
      lastGestureRef.current = null;
      phaseRef.current = phase;
      return;
    }

    const cfg = motionsForState(phase, motions);
    if (!cfg.gestures.length) return;

    const phaseChanged = phaseRef.current !== phase;
    phaseRef.current = phase;

    host.pausePresence("agent_status");
    pausedRef.current = true;

    const playNext = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastPlayAtRef.current < STATUS_GESTURE_COOLDOWN_MS) return;
      const id = pickStatusGesture(cfg.gestures, lastGestureRef.current);
      if (!id) return;
      // Same clip still "playing" in the pool — skip rather than re-fire.
      if (!force && id === lastGestureRef.current && now - lastPlayAtRef.current < cfg.intervalMs) {
        return;
      }
      lastGestureRef.current = id;
      lastPlayAtRef.current = now;
      host.playGesture(id, false, "agent", "status");
    };

    // Only fire immediately when entering a new live phase (or first mount).
    if (phaseChanged) playNext(true);

    const timer = window.setInterval(() => playNext(false), Math.max(cfg.intervalMs, STATUS_GESTURE_COOLDOWN_MS));
    return () => {
      window.clearInterval(timer);
      // Keep presence paused across same-agent phase transitions; resume only
      // when leaving live work (handled above) or unmounting the host later.
    };
  }, [agentStatus?.authorSlug, agentStatus?.state, enabled, focusedSlug, host, motions, onMood]);

  useEffect(() => {
    return () => {
      if (pausedRef.current && host) {
        host.resumePresence();
        pausedRef.current = false;
      }
    };
  }, [host]);
}
