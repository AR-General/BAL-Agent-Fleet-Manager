import type { FleetEvent } from "./types";

type Props = {
  events: FleetEvent[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onOpenSession?: (sessionId: string) => void;
};

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

function eventSummary(event: FleetEvent): string {
  if (event.summary?.trim()) return event.summary;

  const fallback = event.data.summary;
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback;
  }

  return "No summary available.";
}

function previewJson(data: Record<string, unknown>): string {
  const raw = JSON.stringify(data, null, 2);
  return raw.length > 480 ? `${raw.slice(0, 480)}...` : raw;
}

export function EventsPanel({ events, loading, error, onRefresh, onOpenSession }: Props) {
  return (
    <section className="chat-side-panel">
      <div className="chat-side-panel-head">
        <div>
          <h3>Live events</h3>
          <p className="muted">Recent fleet activity that can spawn or update rooms.</p>
        </div>
        <button type="button" className="secondary" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {loading && <p className="muted">Loading live events...</p>}
      {!loading && error && <p className="badge bad">{error}</p>}
      {!loading && !error && !events.length && (
        <p className="chat-side-panel-empty muted">No recent events available.</p>
      )}

      <div className="chat-event-list">
        {events.map((event) => (
          <article key={event.id} className="chat-event-card card">
            <div className="chat-event-head">
              <strong>{event.eventType}</strong>
              <span className="muted">{formatTimestamp(event.createdAt)}</span>
            </div>
            <p>{eventSummary(event)}</p>

            {event.tags?.length ? (
              <div className="chat-event-tags">
                {event.tags.map((tag) => (
                  <span key={tag} className="badge">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}

            <pre className="code chat-event-json">{previewJson(event.data)}</pre>

            {event.relatedSessionId && onOpenSession && (
              <button
                type="button"
                className="secondary"
                onClick={() => onOpenSession(event.relatedSessionId!)}
              >
                Open room
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
