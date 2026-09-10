import { useEffect } from "react";
import type { MoveInput } from "@openclaw/character-kit";
import { isTypingTarget, isWalkKey, normalizeWasdKey, stickFromHeldKeys } from "../lib/wasdMove";

const IDLE: MoveInput = { x: 0, z: 0, yaw: 0, jump: false };

/**
 * WASD / arrows / space → setMoveInput, matching solo CompanionHost scene controls.
 * Recreate `setMoveInput` when the controlled avatar changes so cleanup zeros the previous one.
 */
export function useWasdMoveInput(
  setMoveInput: ((input: MoveInput) => void) | null,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || !setMoveInput) return;
    const keys = new Set<string>();

    function flush() {
      setMoveInput(stickFromHeldKeys(keys));
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (!isWalkKey(e.key)) return;
      e.preventDefault();
      keys.add(normalizeWasdKey(e.key));
      flush();
    }
    function onKeyUp(e: KeyboardEvent) {
      if (!isWalkKey(e.key)) return;
      keys.delete(normalizeWasdKey(e.key));
      flush();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      setMoveInput(IDLE);
    };
  }, [enabled, setMoveInput]);
}
