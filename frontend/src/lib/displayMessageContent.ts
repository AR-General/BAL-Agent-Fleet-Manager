import { defaultInlineCatalog, parseInlineTags } from "@openclaw/character-kit";
import { sanitizeTtsText } from "./ttsSanitize";

const INLINE_TAG_CATALOG = defaultInlineCatalog();

/** Strip character-kit inline tags so chat markdown can render the remaining text. */
export function displayMessageContent(content: string): string {
  if (!content.includes("[")) return content;
  try {
    return parseInlineTags(content, INLINE_TAG_CATALOG).displayText.trim() || content;
  } catch (error) {
    console.warn("failed to strip inline tags from chat markdown", {
      error: error instanceof Error ? error.message : String(error),
    });
    return content;
  }
}

/**
 * Character tags stripped; Fish S2 emotion tags stay; markdown/asterisks/unknown
 * brackets removed so Fish does not speak junk.
 */
export function ttsMessageContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  let tts = trimmed;
  try {
    if (trimmed.includes("[")) {
      tts = parseInlineTags(trimmed, INLINE_TAG_CATALOG).ttsText.trim() || trimmed;
    }
  } catch (error) {
    console.warn("failed to strip inline tags from TTS text", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return sanitizeTtsText(tts).text;
}
