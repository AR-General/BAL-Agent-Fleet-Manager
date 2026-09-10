import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  applyMentionInsertion,
  filterMentionSuggestions,
  getAtMentionQuery,
} from "../../lib/atMention";
import {
  loadDraft,
  loadUndoStack,
  popUndo,
  pushUndo,
  saveDraft,
} from "../../lib/composerPersistence";

export type ChatComposerApi = {
  appendTranscript: (transcript: string) => void;
  focus: () => void;
};

type Props = {
  sessionId?: string;
  agentSuggestions: string[];
  participantSlugs: string[];
  sending: boolean;
  stopping: boolean;
  busy: boolean;
  composerApiRef?: MutableRefObject<ChatComposerApi | null>;
  compact?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
};

/**
 * Owns composer draft locally so keystrokes never re-render ChatPage / message list / 3D.
 */
export function ChatComposer({
  sessionId,
  agentSuggestions,
  participantSlugs,
  sending,
  stopping,
  busy,
  composerApiRef,
  compact = false,
  onSend,
  onStop,
}: Props) {
  const [composerText, setComposerText] = useState("");
  const [undoCount, setUndoCount] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caret, setCaret] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<string | null>(null);
  const [writeFullscreen, setWriteFullscreen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setComposerText("");
      setUndoCount(0);
      return;
    }
    setComposerText(loadDraft(sessionId));
    setUndoCount(loadUndoStack(sessionId).length);
    setMentionIndex(0);
    setMentionDismissed(null);
    setCaret(0);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      saveDraft(sessionId, composerText);
    }, 200);
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [composerText, sessionId]);

  useEffect(() => {
    if (!composerApiRef) return;
    composerApiRef.current = {
      appendTranscript: (transcript: string) => {
        if (!transcript) {
          setComposerText((current) => (current ? `${current}\n` : ""));
          return;
        }
        setComposerText((current) => `${current}${transcript}`);
      },
      focus: () => {
        textareaRef.current?.focus();
      },
    };
    return () => {
      composerApiRef.current = null;
    };
  }, [composerApiRef]);

  const mentionQuery = useMemo(
    () => getAtMentionQuery(composerText, caret),
    [composerText, caret],
  );
  const mentionOptions = useMemo(() => {
    if (!mentionQuery) return [];
    const dismissKey = `${mentionQuery.start}:${mentionQuery.query}`;
    if (mentionDismissed === dismissKey) return [];
    const preferred = participantSlugs;
    const pool = [
      ...preferred,
      ...agentSuggestions.filter((slug) => !preferred.includes(slug)),
    ];
    return filterMentionSuggestions(pool, mentionQuery.query);
  }, [agentSuggestions, mentionDismissed, mentionQuery, participantSlugs]);

  const mentionOpen = mentionOptions.length > 0;
  const canSend = Boolean(sessionId && composerText.trim()) && !stopping;
  const hasDraft = Boolean(composerText.trim());

  useEffect(() => {
    if (!mentionQuery) {
      setMentionDismissed(null);
      return;
    }
    const key = `${mentionQuery.start}:${mentionQuery.query}`;
    setMentionDismissed((prev) => (prev && prev !== key ? null : prev));
  }, [mentionQuery]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery?.start, mentionQuery?.query, mentionOptions.length]);

  function syncCaret(el: HTMLTextAreaElement | null = textareaRef.current) {
    if (!el) return;
    setCaret(el.selectionStart ?? el.value.length);
  }

  function insertMention(slug: string) {
    if (!mentionQuery) return;
    const next = applyMentionInsertion(composerText, caret, mentionQuery.start, slug);
    setComposerText(next.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  }

  function handleUndo() {
    if (!sessionId) return;
    const { text, stack } = popUndo(sessionId);
    setUndoCount(stack.length);
    if (text != null) setComposerText(text);
  }

  function submit() {
    if (!canSend || !sessionId) return;
    const outgoing = composerText.trim();
    pushUndo(sessionId, outgoing);
    setUndoCount(loadUndoStack(sessionId).length);
    setComposerText("");
    saveDraft(sessionId, "");
    onSend(outgoing);
    setWriteFullscreen(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mentionOpen) return;
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionOptions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const slug = mentionOptions[mentionIndex] || mentionOptions[0];
        if (slug) insertMention(slug);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (mentionQuery) {
          setMentionDismissed(`${mentionQuery.start}:${mentionQuery.query}`);
          setMentionIndex(0);
        }
        return;
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "z" && !event.shiftKey) {
      event.preventDefault();
      handleUndo();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) submit();
    }
  }

  return (
    <form
      className={`chat-composer card ${compact ? "chat-composer-compact" : ""} ${
        writeFullscreen ? "chat-composer-write-fs" : ""
      }`}
      onSubmit={handleSubmit}
    >
      {compact ? null : (
        <div className="chat-composer-head">
          <div>
            <strong>Message</strong>
            <p className="muted">Type @ for agents · Ctrl/Cmd+Z undoes</p>
          </div>
          <span className="muted">{Math.ceil(composerText.length / 4)} tokens est.</span>
        </div>
      )}

      {compact && (hasDraft || writeFullscreen) ? (
        <div className="chat-composer-send-row">
          {writeFullscreen ? (
            <button
              type="button"
              className="secondary chat-composer-fs-close"
              onClick={() => setWriteFullscreen(false)}
            >
              Close
            </button>
          ) : null}
          <button type="submit" className="chat-composer-send-inline" disabled={!canSend || stopping}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      ) : null}

      <div className="chat-composer-input-wrap">
        {mentionOpen ? (
          <ul className="chat-mention-menu" role="listbox" aria-label="Mention agent">
            {mentionOptions.map((slug, i) => (
              <li key={slug}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === mentionIndex}
                  className={i === mentionIndex ? "active" : ""}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertMention(slug);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                >
                  @{slug}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={textareaRef}
          className="chat-composer-input"
          value={composerText}
          onChange={(event) => {
            setComposerText(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          onClick={() => syncCaret()}
          onKeyUp={() => syncCaret()}
          onSelect={() => syncCaret()}
          onKeyDown={handleKeyDown}
          placeholder={sessionId ? "Message…" : "Select a session first"}
          disabled={!sessionId || stopping}
          rows={writeFullscreen ? undefined : compact ? 2 : 3}
        />
        {compact ? (
          <button
            type="button"
            className="secondary chat-composer-expand-btn"
            title={writeFullscreen ? "Exit full-screen write" : "Write full screen"}
            aria-label={writeFullscreen ? "Exit full-screen write" : "Write full screen"}
            disabled={!sessionId}
            onClick={() => {
              setWriteFullscreen((current) => !current);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          >
            {writeFullscreen ? "↘" : "⛶"}
          </button>
        ) : null}
      </div>

      {compact && !busy ? null : (
      <div className="chat-composer-actions">
        {compact ? null : (
          <span className="muted">
            {busy
              ? "Agents working — Stop all cancels every in-flight reply."
              : "Ready to send. Queued until the server ACK."}
          </span>
        )}
        <div className="chat-composer-action-btns">
          {compact ? null : (
            <button type="button" className="secondary" disabled={!undoCount} onClick={handleUndo}>
              Undo ({undoCount})
            </button>
          )}
          {busy ? (
            <button
              type="button"
              className="secondary chat-stop-all-btn"
              onClick={onStop}
              disabled={stopping}
            >
              {stopping ? "Stopping..." : "Stop all"}
            </button>
          ) : null}
          {compact ? null : (
            <button type="submit" disabled={!canSend || stopping}>
              {sending ? "Sending..." : "Send"}
            </button>
          )}
        </div>
      </div>
      )}
    </form>
  );
}
