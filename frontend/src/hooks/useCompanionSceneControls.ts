import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACTION_FEED_MAX,
  DEFAULT_GAZE_LIMITS,
  formatActionDelta,
  listPresenceMoods,
  LOCO_WALK_SPEED,
  type CharacterActionEvent,
  type CompanionHost,
  type MoveInput,
} from "@openclaw/character-kit";
import { useWasdMoveInput } from "./useWasdMoveInput";

export type CompanionSceneControlState = {
  pointerLook: boolean;
  setPointerLook: (v: boolean) => void;
  bodyFollow: boolean;
  setBodyFollow: (v: boolean) => void;
  keysOn: boolean;
  setKeysOn: (v: boolean) => void;
  walkSpeed: number;
  setWalkSpeed: (v: number) => void;
  headYaw: number;
  setHeadYaw: (v: number) => void;
  eyeYaw: number;
  setEyeYaw: (v: number) => void;
  gestures: string[];
  actions: CharacterActionEvent[];
  clearActions: () => void;
  loopGesture: boolean;
  setLoopGesture: (v: boolean) => void;
  moods: ReturnType<typeof listPresenceMoods>;
  formatActionDelta: typeof formatActionDelta;
};

/** Keeps WASD / gaze / loco wired even when the config UI is closed. */
export function useCompanionSceneControls(
  host: CompanionHost | null,
  opts?: { actionFeedEnabled?: boolean },
): CompanionSceneControlState {
  const actionFeedEnabled = opts?.actionFeedEnabled !== false;
  const [pointerLook, setPointerLook] = useState(true);
  const [bodyFollow, setBodyFollow] = useState(false);
  const [keysOn, setKeysOn] = useState(true);
  const [walkSpeed, setWalkSpeed] = useState(LOCO_WALK_SPEED);
  const [headYaw, setHeadYaw] = useState(DEFAULT_GAZE_LIMITS.headYawMaxDeg);
  const [eyeYaw, setEyeYaw] = useState(DEFAULT_GAZE_LIMITS.eyeYawMaxDeg);
  const [gestures, setGestures] = useState<string[]>([]);
  const [actions, setActions] = useState<CharacterActionEvent[]>([]);
  const [loopGesture, setLoopGesture] = useState(false);

  const moods = useMemo(() => listPresenceMoods(), []);

  useEffect(() => {
    if (!host) return;
    setGestures(host.listGestures());
  }, [host]);

  useEffect(() => {
    if (!host || !actionFeedEnabled) return;
    const off = host.onAction((ev) => {
      setActions((prev) => [ev, ...prev].slice(0, ACTION_FEED_MAX));
    });
    return off;
  }, [actionFeedEnabled, host]);

  useEffect(() => {
    if (!host) return;
    host.setPointerLookEnabled(pointerLook);
  }, [host, pointerLook]);

  useEffect(() => {
    if (!host) return;
    host.setBodyFollowCamera(bodyFollow);
  }, [host, bodyFollow]);

  useEffect(() => {
    if (!host) return;
    host.setGazeLimits({ headYawMaxDeg: headYaw, eyeYawMaxDeg: eyeYaw });
  }, [host, headYaw, eyeYaw]);

  useEffect(() => {
    if (!host) return;
    host.setAnalogSpeed(walkSpeed);
  }, [host, walkSpeed]);

  const applyWasd = useCallback(
    (input: MoveInput) => {
      host?.setMoveInput(input);
    },
    [host],
  );
  useWasdMoveInput(host ? applyWasd : null, Boolean(host) && keysOn);

  return {
    pointerLook,
    setPointerLook,
    bodyFollow,
    setBodyFollow,
    keysOn,
    setKeysOn,
    walkSpeed,
    setWalkSpeed,
    headYaw,
    setHeadYaw,
    eyeYaw,
    setEyeYaw,
    gestures,
    actions,
    clearActions: () => setActions([]),
    loopGesture,
    setLoopGesture,
    moods,
    formatActionDelta,
  };
}
