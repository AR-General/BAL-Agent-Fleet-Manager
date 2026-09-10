import { memo, useState } from "react";
import { displayMessageContent } from "../../lib/displayMessageContent";
import { MarkdownContent } from "./MarkdownContent";
import { ExpandableLabel } from "../common/ExpandableLabel";
import type { ChatMessage, MessageReaction, ToolCallVisual } from "./types";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ToolCallCard({ call }: { call: ToolCallVisual }) {
  const [argsOpen, setArgsOpen] = useState(false);
  const title = call.label || call.tool || "tool";
  const args = call.arguments?.trim() || "";
  const argsLong = args.length > 80;

  return (
    <div className="chat-tool-call">
      <span className="chat-tool-call-emoji">{call.emoji || "🛠️"}</span>
      <div>
        <ExpandableLabel className="chat-tool-call-title" text={title} max={42} />
        <span className="muted"> · {call.status || "running"}</span>
        {args ? (
          argsLong ? (
            <button
              type="button"
              className="chat-tool-call-args-toggle"
              aria-expanded={argsOpen}
              onClick={() => setArgsOpen((current) => !current)}
            >
              <pre className="chat-tool-call-args">{argsOpen ? args : `${args.slice(0, 80).trimEnd()}…`}</pre>
            </button>
          ) : (
            <pre className="chat-tool-call-args">{args}</pre>
          )
        ) : null}
      </div>
    </div>
  );
}

function ReactionPills({ reactions }: { reactions?: MessageReaction[] }) {
  if (!reactions?.length) return null;
  return (
    <div className="chat-message-reactions" aria-label="Agent reactions">
      {reactions.map((r) => (
        <span key={`${r.slug}-${r.kind}`} className={`chat-reaction-pill ${r.kind}`} title={r.kind}>
          <span className="chat-reaction-kind">{r.kind}</span>
          <span className="chat-reaction-slug">@{r.slug}</span>
        </span>
      ))}
    </div>
  );
}

const ChatMessageRow = memo(function ChatMessageRow({ message }: { message: ChatMessage }) {
  const source = message.content ? displayMessageContent(message.content) : "";
  return (
    <article
      className={`chat-message ${message.role === "assistant" ? "assistant" : ""} ${
        message.status === "failed" ? "failed" : ""
      }`}
    >
      <div className="chat-message-meta muted">
        <span>{message.authorSlug || message.authorType}</span>
        <span>{message.role}</span>
        <span>{formatTimestamp(message.createdAt)}</span>
        {message.status === "streaming" && <span className="badge warn">Streaming</span>}
        {message.status === "queued" && <span className="badge warn">Queued</span>}
        {message.status === "sending" && <span className="badge warn">Sending</span>}
        {message.status === "failed" && <span className="badge bad">Failed</span>}
      </div>
      <ReactionPills reactions={message.reactions} />
      {message.toolCalls?.length ? (
        <div className="chat-tool-calls">
          {message.toolCalls.map((call) => (
            <ToolCallCard key={call.id} call={call} />
          ))}
        </div>
      ) : null}
      <div className="chat-message-body">
        <MarkdownContent source={source} empty={<span className="muted">...</span>} />
      </div>
    </article>
  );
});

type Props = {
  messages: ChatMessage[];
};

/** Isolated so parent composer keystrokes cannot re-parse markdown history. */
export const ChatMessageList = memo(function ChatMessageList({ messages }: Props) {
  return (
    <>
      {messages.map((message) => (
        <ChatMessageRow key={message.id} message={message} />
      ))}
    </>
  );
});
