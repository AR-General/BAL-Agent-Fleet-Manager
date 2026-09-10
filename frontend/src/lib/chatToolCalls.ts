/** Mirrors backend chatToolCalls clamp for the DM tool-call input. */

export const MAX_TOOL_CALLS_MIN = 1;
export const MAX_TOOL_CALLS_MAX = 200;
export const MAX_TOOL_CALLS_DEFAULT = 50;

export function clampMaxToolCalls(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MAX_TOOL_CALLS_DEFAULT;
  return Math.min(MAX_TOOL_CALLS_MAX, Math.max(MAX_TOOL_CALLS_MIN, Math.floor(n)));
}
