export const DISPLAY_TEXT_PREVIEW_CHARS = 28;

export function truncateDisplayText(
  text: string,
  max = DISPLAY_TEXT_PREVIEW_CHARS,
): { preview: string; truncated: boolean } {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return { preview: trimmed, truncated: false };
  const keep = Math.max(1, max - 1);
  return { preview: `${trimmed.slice(0, keep).trimEnd()}…`, truncated: true };
}
