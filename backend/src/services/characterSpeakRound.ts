import type { HermesMessage, HermesToolCall } from "./hermesClient.js";
import {
  CHARACTER_SPEAK_TOOL_NAME,
  parseCharacterSpeakArgs,
} from "./characterSpeakTool.js";

export type SpeakEmit = {
  tool_call_id: string;
  text: string;
};

export type SpeakRoundResult = {
  speakEvents: SpeakEmit[];
  continuationMessages: HermesMessage[];
  parseErrors: number;
  /** True when there was at least one character_speak call (loop should continue). */
  shouldContinue: boolean;
};

/**
 * Pure helper for one character_speak tool round: emit speak events + build
 * assistant/tool continuation messages for the next Hermes call.
 */
export function processCharacterSpeakRound(opts: {
  toolCalls: HermesToolCall[];
  roundContent: string;
}): SpeakRoundResult {
  const speakCalls = opts.toolCalls.filter((c) => c.name === CHARACTER_SPEAK_TOOL_NAME);
  const speakEvents: SpeakEmit[] = [];
  let parseErrors = 0;

  const continuationMessages: HermesMessage[] = [];
  if (!speakCalls.length) {
    return { speakEvents, continuationMessages, parseErrors, shouldContinue: false };
  }

  continuationMessages.push({
    role: "assistant",
    content: opts.roundContent || "",
    tool_calls: speakCalls.map((c) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: c.arguments },
    })),
  });

  for (const call of speakCalls) {
    const parsed = parseCharacterSpeakArgs(call.arguments);
    if (parsed.ok) {
      speakEvents.push({ tool_call_id: call.id, text: parsed.text });
      continuationMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({ ok: true }),
      });
    } else {
      parseErrors += 1;
      continuationMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({ ok: false, message: parsed.message }),
      });
    }
  }

  return {
    speakEvents,
    continuationMessages,
    parseErrors,
    shouldContinue: true,
  };
}
