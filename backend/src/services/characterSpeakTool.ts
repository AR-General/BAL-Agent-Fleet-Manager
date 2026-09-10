/** OpenAI-compatible schema + helpers for the `character_speak` tool. */

export const CHARACTER_SPEAK_TOOL_NAME = "character_speak";

export const CHARACTER_SPEAK_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: CHARACTER_SPEAK_TOOL_NAME,
    description:
      "Speak a short conversational line with TTS + avatar lip-sync. Optional [gesture]/[mood]/Fish prosody tags inside text drive motion and voice. Use for mid-task narration or a brief wrap-up. Do NOT put long answers, code, tables, or links here — those go in the printed assistant reply (never spoken).",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "Short spoken utterance (1–2 sentences). May include inline tags like [wave], [mood:playful], [happy=40], or Fish tags like [happy]/[break].",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
};

export const CHARACTER_SPEAK_MAX_ROUNDS = 4;

export type ParsedSpeakArgs =
  | { ok: true; text: string }
  | { ok: false; message: string };

export function parseCharacterSpeakArgs(raw: string): ParsedSpeakArgs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { ok: false, message: "invalid JSON arguments" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, message: "arguments must be an object" };
  }
  const text = (parsed as { text?: unknown }).text;
  if (typeof text !== "string") {
    return { ok: false, message: "text must be a string" };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: "text must be non-empty" };
  }
  return { ok: true, text: trimmed };
}

/** Compact system-prompt block when tts_speak_mode is "tool". */
export function formatCharacterSpeakPrompt(): string {
  return [
    "Voice (character_speak is a real tool; this is the only TTS path in tool mode):",
    "- Call character_speak for short (1–2 sentence) spoken lines: greet/ack, progress, or a wrap-up. Inline tags in that text still drive motion and Fish prosody: [wave], [mood:playful], [happy=40], [break].",
    "- The printed assistant body is NEVER spoken. Put markdown, code, tables, and links there. Do not paste the full answer into character_speak.",
    "- Typical: character_speak near the start, optional character_speak near the end, then the full text answer in the message body.",
    "- This tool speaks YOUR avatar only. Peers hear the room; they do not speak unless they call character_speak on their own turn.",
    "- Zero or more calls per turn are fine; skip speaking when silence is better.",
  ].join("\n");
}

/** Fresh schema for this generation so the tool description lists current room members. */
export function characterSpeakToolSchema(opts?: {
  selfSlug?: string;
  peerSlugs?: string[];
}): typeof CHARACTER_SPEAK_TOOL_SCHEMA {
  const peers = [...new Set((opts?.peerSlugs || []).map((s) => s.trim()).filter(Boolean))];
  const self = opts?.selfSlug?.trim();
  const others = self ? peers.filter((s) => s.toLowerCase() !== self.toLowerCase()) : peers;
  const bits: string[] = [CHARACTER_SPEAK_TOOL_SCHEMA.function.description];
  if (self) bits.push(`You are @${self}.`);
  if (peers.length) bits.push(`Room members right now: ${peers.map((s) => `@${s}`).join(", ")}.`);
  if (others.length) {
    bits.push(`This call only speaks your avatar, not ${others.map((s) => `@${s}`).join(", ")}.`);
  }
  return {
    type: "function",
    function: {
      name: CHARACTER_SPEAK_TOOL_NAME,
      description: bits.join(" "),
      parameters: CHARACTER_SPEAK_TOOL_SCHEMA.function.parameters,
    },
  };
}
