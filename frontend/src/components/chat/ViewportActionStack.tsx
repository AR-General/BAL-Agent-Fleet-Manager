import { useEffect, useRef, useState } from "react";
import { ExpandableLabel } from "../common/ExpandableLabel";
import {
  expireToolActionToasts,
  upsertToolActionToast,
  type ToolActionToast,
  type ViewportToolEvent,
} from "../../lib/toolActionToasts";

type Props = {
  events: ViewportToolEvent[];
  /** Reset seen ids when the chat session changes. */
  sessionId?: string;
  /** When set, only show tools from this agent (split cells). */
  filterSlug?: string;
};

/**
 * Compact disappearing stack of agent tool calls — game-style reward pop-ins.
 * Chat still shows the full tool cards; this is the 3D overlay feed.
 */
export function ViewportActionStack({ events, sessionId, filterSlug }: Props) {
  const [toasts, setToasts] = useState<ToolActionToast[]>([]);
  const seenRef = useRef<Map<string, string>>(new Map());
  const seededRef = useRef(false);

  useEffect(() => {
    seenRef.current = new Map();
    seededRef.current = false;
    setToasts([]);
  }, [sessionId, filterSlug]);

  useEffect(() => {
    const relevant = filterSlug
      ? events.filter((event) => !event.authorSlug || event.authorSlug === filterSlug)
      : events;
    if (!relevant.length) return;

    if (!seededRef.current) {
      seededRef.current = true;
      for (const event of relevant) {
        seenRef.current.set(event.id, event.status || "running");
        if (event.status === "running") {
          setToasts((current) => upsertToolActionToast(current, event));
        }
      }
      return;
    }

    for (const event of relevant) {
      const prev = seenRef.current.get(event.id);
      const status = event.status || "running";
      if (prev === status) continue;
      const isNew = prev === undefined;
      seenRef.current.set(event.id, status);
      setToasts((current) => upsertToolActionToast(current, event, Date.now(), { bumpCount: isNew }));
    }
  }, [events, filterSlug]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = window.setInterval(() => {
      setToasts((current) => expireToolActionToasts(current));
    }, 120);
    return () => window.clearInterval(timer);
  }, [toasts.length]);

  if (!toasts.length) return null;

  return (
    <ol className="viewport-action-stack" aria-label="Agent tool actions">
      {toasts.map((toast) => (
        <li
          key={toast.id}
          className={`viewport-action-toast ${toast.leaving ? "out" : "in"}`}
          data-kind={toast.kind}
          data-status={toast.status}
          data-pulse={toast.pulse}
        >
          <span className="viewport-action-emoji" aria-hidden>
            {toast.emoji}
          </span>
          <ExpandableLabel
            className="viewport-action-label"
            text={toast.fullLabel || toast.label}
            max={22}
          />
          {!filterSlug && toast.authorSlug ? (
            <span className="viewport-action-slug">@{toast.authorSlug}</span>
          ) : null}
          {toast.count > 1 ? <span className="viewport-action-count">×{toast.count}</span> : null}
        </li>
      ))}
    </ol>
  );
}
