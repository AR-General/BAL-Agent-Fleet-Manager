import { incMetric, setGauge } from "../utils/metrics.js";

export type SessionLiveAgentStatus = {
  state: string;
  emoji?: string;
  label?: string;
  authorSlug?: string;
  messageId?: string;
};

export type SessionLiveStream = {
  messageId: string;
  content: string;
  role: string;
  authorType: string;
  authorSlug?: string;
};

export type SessionLiveSnapshot = {
  sessionId: string;
  generating: boolean;
  updatedAt: string;
  /** Latest status (compat for single-chip UIs). */
  agentStatus: SessionLiveAgentStatus | null;
  /** Latest stream (compat). */
  stream: SessionLiveStream | null;
  /** Per-author live status for parallel group replies. */
  agentStatuses: Record<string, SessionLiveAgentStatus>;
  /** Per-author / per-message streams keyed by message_id. */
  streams: Record<string, SessionLiveStream>;
};

const live = new Map<string, SessionLiveSnapshot>();

function emptySnapshot(sessionId: string): SessionLiveSnapshot {
  return {
    sessionId,
    generating: false,
    updatedAt: new Date().toISOString(),
    agentStatus: null,
    stream: null,
    agentStatuses: {},
    streams: {},
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isTerminalState(state: string | undefined): boolean {
  return state === "done" || state === "cancelled";
}

function recomputeGenerating(row: SessionLiveSnapshot): boolean {
  for (const status of Object.values(row.agentStatuses)) {
    if (!isTerminalState(status.state)) return true;
  }
  return Object.keys(row.streams).length > 0;
}

function pickLatestStatus(row: SessionLiveSnapshot): SessionLiveAgentStatus | null {
  const values = Object.values(row.agentStatuses);
  if (!values.length) return null;
  const active = values.find((s) => !isTerminalState(s.state));
  return active || values[values.length - 1] || null;
}

function pickLatestStream(row: SessionLiveSnapshot): SessionLiveStream | null {
  const values = Object.values(row.streams);
  return values.length ? values[values.length - 1]! : null;
}

function touchGauge(): void {
  let generating = 0;
  for (const row of live.values()) {
    if (row.generating) generating += 1;
  }
  setGauge("oc_chat_session_generating", "Sessions currently generating a reply", generating);
}

export function getSessionLive(sessionId: string): SessionLiveSnapshot {
  return live.get(sessionId) ?? emptySnapshot(sessionId);
}

export function listGeneratingSessionIds(): string[] {
  return [...live.values()].filter((row) => row.generating).map((row) => row.sessionId);
}

export function clearSessionLive(sessionId: string): SessionLiveSnapshot {
  const next = emptySnapshot(sessionId);
  live.delete(sessionId);
  touchGauge();
  return next;
}

/** Mark every live author cancelled and drop streams (Stop all / session interrupt). */
export function cancelAllSessionLive(sessionId: string): SessionLiveSnapshot {
  const current = live.get(sessionId) ?? emptySnapshot(sessionId);
  const agentStatuses: Record<string, SessionLiveAgentStatus> = {};
  for (const [key, status] of Object.entries(current.agentStatuses)) {
    agentStatuses[key] = {
      ...status,
      state: "cancelled",
      emoji: "⏹️",
      label: "cancelled",
    };
  }
  if (!Object.keys(agentStatuses).length) {
    agentStatuses._ = {
      state: "cancelled",
      emoji: "⏹️",
      label: "cancelled",
    };
  }
  const next: SessionLiveSnapshot = {
    sessionId,
    generating: false,
    updatedAt: new Date().toISOString(),
    agentStatuses,
    streams: {},
    agentStatus: {
      state: "cancelled",
      emoji: "⏹️",
      label: "cancelled",
    },
    stream: null,
  };
  live.set(sessionId, next);
  touchGauge();
  return next;
}

/** Cancel one author's live status and drop their streams. */
export function cancelAuthorSessionLive(
  sessionId: string,
  authorSlug: string,
): SessionLiveSnapshot {
  const current = live.get(sessionId) ?? emptySnapshot(sessionId);
  const agentStatuses = { ...current.agentStatuses };
  const streams = { ...current.streams };
  for (const [id, stream] of Object.entries(streams)) {
    if (stream.authorSlug === authorSlug) delete streams[id];
  }
  const prev = agentStatuses[authorSlug];
  agentStatuses[authorSlug] = {
    state: "cancelled",
    emoji: "⏹️",
    label: "cancelled",
    authorSlug,
    messageId: prev?.messageId,
  };
  const next: SessionLiveSnapshot = {
    ...current,
    sessionId,
    updatedAt: new Date().toISOString(),
    agentStatuses,
    streams,
  };
  next.generating = recomputeGenerating(next);
  next.agentStatus = pickLatestStatus(next);
  next.stream = pickLatestStream(next);
  live.set(sessionId, next);
  touchGauge();
  return next;
}

/** Apply a WS session event onto the in-memory generation snapshot. */
export function applySessionEvent(
  sessionId: string,
  payload: Record<string, unknown>,
): SessionLiveSnapshot {
  const type = asString(payload.type);
  const current = live.get(sessionId) ?? emptySnapshot(sessionId);
  const next: SessionLiveSnapshot = {
    ...current,
    sessionId,
    updatedAt: new Date().toISOString(),
    agentStatuses: { ...current.agentStatuses },
    streams: { ...current.streams },
  };

  const authorSlug = asString(payload.author_slug) ?? asString(payload.authorSlug);
  const messageId = asString(payload.message_id) ?? asString(payload.messageId);
  const statusKey = authorSlug || messageId || "_";

  if (type === "agent_status") {
    const state = asString(payload.state) || "thinking";
    const status: SessionLiveAgentStatus = {
      state,
      emoji: asString(payload.emoji),
      label: asString(payload.label),
      authorSlug,
      messageId,
    };
    next.agentStatuses[statusKey] = status;
    if (isTerminalState(state) && messageId) {
      delete next.streams[messageId];
    }
  }

  if (type === "message_delta") {
    const content = typeof payload.content === "string" ? payload.content : "";
    if (messageId) {
      next.streams[messageId] = {
        messageId,
        content:
          content ||
          (typeof payload.delta === "string"
            ? (next.streams[messageId]?.content || "") + payload.delta
            : next.streams[messageId]?.content || ""),
        role: asString(payload.role) || "assistant",
        authorType: asString(payload.author_type) ?? asString(payload.authorType) ?? "instance",
        authorSlug: authorSlug ?? next.streams[messageId]?.authorSlug,
      };
      if (typeof payload.content === "string") {
        next.streams[messageId].content = payload.content;
      }
    }
  }

  if (type === "tool_progress" || type === "tool_call") {
    const existing = next.agentStatuses[statusKey];
    if (!existing || isTerminalState(existing.state)) {
      next.agentStatuses[statusKey] = {
        state: "running",
        emoji: asString(payload.emoji) || "⚙️",
        label: asString(payload.label) ?? asString(payload.tool) ?? "tool",
        authorSlug,
        messageId,
      };
    }
  }

  if (type === "message_done" || type === "message") {
    const aborted = payload.aborted === true;
    const streamId = asString(payload.stream_id) ?? messageId;
    if (streamId) delete next.streams[streamId];
    if (messageId && messageId !== streamId) delete next.streams[messageId];

    const doneStatus: SessionLiveAgentStatus = {
      state: aborted ? "cancelled" : "done",
      emoji: aborted ? "⏹️" : "✅",
      label: aborted ? "cancelled" : "done",
      authorSlug: authorSlug ?? next.agentStatuses[statusKey]?.authorSlug,
      messageId,
    };
    if (authorSlug || statusKey !== "_") {
      next.agentStatuses[statusKey] = doneStatus;
    }
  }

  next.generating = recomputeGenerating(next);
  next.agentStatus = pickLatestStatus(next);
  next.stream = pickLatestStream(next);

  live.set(sessionId, next);
  touchGauge();
  return next;
}

export function snapshotForClient(sessionId: string): Record<string, unknown> {
  const row = getSessionLive(sessionId);
  incMetric("oc_chat_session_sync_total", "Session live snapshots sent to WS clients");
  return {
    type: "session_sync",
    session_id: sessionId,
    generating: row.generating,
    updated_at: row.updatedAt,
    agent_status: row.agentStatus
      ? {
          state: row.agentStatus.state,
          emoji: row.agentStatus.emoji,
          label: row.agentStatus.label,
          author_slug: row.agentStatus.authorSlug,
          message_id: row.agentStatus.messageId,
        }
      : null,
    agent_statuses: Object.fromEntries(
      Object.entries(row.agentStatuses).map(([key, status]) => [
        key,
        {
          state: status.state,
          emoji: status.emoji,
          label: status.label,
          author_slug: status.authorSlug,
          message_id: status.messageId,
        },
      ]),
    ),
    stream: row.stream
      ? {
          message_id: row.stream.messageId,
          content: row.stream.content,
          role: row.stream.role,
          author_type: row.stream.authorType,
          author_slug: row.stream.authorSlug,
        }
      : null,
    streams: Object.fromEntries(
      Object.entries(row.streams).map(([id, stream]) => [
        id,
        {
          message_id: stream.messageId,
          content: stream.content,
          role: stream.role,
          author_type: stream.authorType,
          author_slug: stream.authorSlug,
        },
      ]),
    ),
  };
}
