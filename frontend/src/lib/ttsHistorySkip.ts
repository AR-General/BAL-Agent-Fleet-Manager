/** TTS should never replay messages that were already on screen. */

export type HistorySkipMessage = {
  id?: string;
  role?: string;
  status?: string;
  sessionId?: string;
};

export function collectCompletedAssistantIds(
  messages: HistorySkipMessage[],
  sessionId?: string | null,
): Record<string, true> {
  const ids: Record<string, true> = {};
  for (const message of messages) {
    if (message.role !== "assistant" || !message.id) continue;
    if (message.status === "streaming") continue;
    if (sessionId && message.sessionId && message.sessionId !== sessionId) continue;
    ids[message.id] = true;
  }
  return ids;
}

/** True when TTS just became active for this speaker — existing text is backlog, not live speech. */
export function shouldIgnoreExistingTtsText(opts: {
  justEnabled: boolean;
  sessionChanged: boolean;
  slugWasDisabled: boolean;
}): boolean {
  return opts.justEnabled || opts.sessionChanged || opts.slugWasDisabled;
}

export function spokenCursorAtEnd(messageId: string, text: string): {
  messageId: string;
  spokenOffset: number;
  lastText: string;
} {
  return { messageId, spokenOffset: text.length, lastText: text };
}
