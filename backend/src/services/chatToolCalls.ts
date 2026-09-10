/** Per-session cap on Hermes tool-calling rounds for a single generation. */

export const MAX_TOOL_CALLS_MIN = 1;
export const MAX_TOOL_CALLS_MAX = 200;
export const MAX_TOOL_CALLS_DEFAULT = 50;

/** Floor so a handful of tools is not killed by the old 120s stream abort. */
const STREAM_TIMEOUT_MIN_MS = 180_000;
const STREAM_TIMEOUT_MAX_MS = 1_800_000;
const STREAM_TIMEOUT_PER_CALL_MS = 12_000;

export function clampMaxToolCalls(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MAX_TOOL_CALLS_DEFAULT;
  return Math.min(MAX_TOOL_CALLS_MAX, Math.max(MAX_TOOL_CALLS_MIN, Math.floor(n)));
}

export function hermesStreamTimeoutMs(maxToolCalls: unknown): number {
  const n = clampMaxToolCalls(maxToolCalls);
  return Math.min(STREAM_TIMEOUT_MAX_MS, Math.max(STREAM_TIMEOUT_MIN_MS, n * STREAM_TIMEOUT_PER_CALL_MS));
}
