import type { MoveInput } from "@nexus/character-kit";

const WALK_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  " ",
  "space",
]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function normalizeWasdKey(key: string): string {
  return key === " " ? "space" : key.toLowerCase();
}

export function isWalkKey(key: string): boolean {
  return WALK_KEYS.has(normalizeWasdKey(key)) || WALK_KEYS.has(key.toLowerCase());
}

export function stickFromHeldKeys(keys: Iterable<string>): MoveInput {
  const held = new Set([...keys].map((k) => normalizeWasdKey(k)));
  const z =
    held.has("w") || held.has("arrowup") ? -1 : held.has("s") || held.has("arrowdown") ? 1 : 0;
  const x =
    held.has("a") || held.has("arrowleft") ? -1 : held.has("d") || held.has("arrowright") ? 1 : 0;
  return {
    x,
    z,
    yaw: 0,
    jump: held.has("space"),
  };
}
