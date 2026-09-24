import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { filterLlmCatalog, type LlmModelOption } from "../../lib/llmModels";
import { usePortalMode } from "../../stores/portalMode";
import { ModelSelect } from "./ModelSelect";
import { SessionAvatarBadge, type ProfilePreviews } from "./SessionAvatarBadge";
import type { DbInstance } from "../../types";
import type { Session } from "./types";

type CreateMode = "direct" | "group" | "channel" | null;

type CreateSessionInput = {
  title: string;
  sessionType: "direct" | "group";
  participantInstanceSlugs?: string[];
  origin?: string;
  slug?: string;
  modelId?: string;
};

type AgentModel = LlmModelOption;

type Props = {
  activeSessions: Session[];
  archivedSessions: Session[];
  instances: DbInstance[];
  selectedSessionId?: string;
  showArchived: boolean;
  hideDefaultAutoRooms: boolean;
  creating: boolean;
  collapsed?: boolean;
  drawer?: boolean;
  onToggleCollapsed?: () => void;
  /** Per-session pulse: unread count + agent think emoji/state. */
  sessionPulse?: Record<string, { unread?: number; emoji?: string; state?: string }>;
  onSelectSession: (session: Session) => void;
  onCreateSession: (input: CreateSessionInput) => Promise<void>;
  onArchiveSession: (session: Session) => Promise<void>;
  onResumeSession: (session: Session) => Promise<void>;
  onToggleArchived: () => void;
  onToggleHideDefaultAutoRooms: () => void;
};

function formatTimestamp(value: string | null): string {
  if (!value) return "No activity yet";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isDefaultAutoRoom(session: Session): boolean {
  if (session.origin !== "event_mention") return false;
  if (session.pinned) return false;

  return !session.title?.trim();
}

function sectionTitle(session: Session): string {
  if (session.title?.trim()) return session.title;
  if (session.slug?.trim()) return `#${session.slug}`;
  return session.id.slice(0, 8);
}

function instanceLabel(instance: DbInstance): string {
  const identity = instance.identity || {};
  const display =
    typeof identity.display_name === "string"
      ? identity.display_name
      : typeof identity.name === "string"
        ? identity.name
        : null;
  const runtime = typeof identity.runtime === "string" ? identity.runtime : null;
  if (display && runtime) return `${display} (${instance.slug})`;
  if (display) return `${display} (${instance.slug})`;
  return instance.slug;
}

function autoTitle(opts: {
  mode: CreateMode;
  agentSlug?: string;
  agentLabel?: string;
  channelSlug?: string;
  participants?: string[];
}): string {
  const when = new Date().toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (opts.mode === "channel") {
    const slug = opts.channelSlug?.trim() || "channel";
    return `#${slug} · ${when}`;
  }
  if (opts.mode === "group") {
    const names = (opts.participants || []).slice(0, 3).join(", ");
    return names ? `Group: ${names} · ${when}` : `New group · ${when}`;
  }
  const agent = opts.agentLabel || opts.agentSlug || "agent";
  return `Chat with ${agent} · ${when}`;
}

function SessionList({
  sessions,
  selectedSessionId,
  emptyMessage,
  actionLabel,
  previews,
  onSelectSession,
  onAction,
}: {
  sessions: Session[];
  selectedSessionId?: string;
  emptyMessage: string;
  actionLabel: string;
  previews: ProfilePreviews;
  onSelectSession: (session: Session) => void;
  onAction: (session: Session) => Promise<void>;
}) {
  if (!sessions.length) {
    return <p className="chat-sidebar-empty muted">{emptyMessage}</p>;
  }

  const actionTitle = actionLabel === "Archive" ? "Archive" : actionLabel;
  const actionGlyph = actionLabel === "Archive" ? "⤓" : "⤴";

  return (
    <div className="chat-sidebar-list">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`chat-sidebar-item ${selectedSessionId === session.id ? "selected" : ""}`}
        >
          <button
            type="button"
            className="chat-sidebar-item-main"
            onClick={() => onSelectSession(session)}
          >
            <SessionAvatarBadge session={session} previews={previews} size={36} />
            <div className="chat-sidebar-item-body">
              <div className="chat-sidebar-item-title-row">
                <strong className="chat-sidebar-item-title">{sectionTitle(session)}</strong>
                {session.pinned ? <span className="chat-sidebar-pin" title="Pinned">◆</span> : null}
              </div>
              <div className="chat-sidebar-item-meta muted">
                <span>{session.sessionType}</span>
                <span aria-hidden="true">·</span>
                <span>{formatTimestamp(session.updatedAt)}</span>
              </div>
            </div>
          </button>
          <button
            type="button"
            className="chat-sidebar-item-action"
            title={actionTitle}
            aria-label={actionTitle}
            onClick={(e) => {
              e.stopPropagation();
              void onAction(session);
            }}
          >
            {actionGlyph}
          </button>
        </div>
      ))}
    </div>
  );
}

export function SessionSidebar({
  activeSessions,
  archivedSessions,
  instances,
  selectedSessionId,
  showArchived,
  hideDefaultAutoRooms,
  creating,
  collapsed = false,
  drawer = false,
  onToggleCollapsed,
  sessionPulse,
  onSelectSession,
  onCreateSession,
  onArchiveSession,
  onResumeSession,
  onToggleArchived,
  onToggleHideDefaultAutoRooms,
}: Props) {
  const portalMode = usePortalMode((s) => s.mode);
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<AgentModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [directParticipant, setDirectParticipant] = useState("");
  const [groupParticipants, setGroupParticipants] = useState<string[]>([]);
  const [createError, setCreateError] = useState("");
  const [profilePreviews, setProfilePreviews] = useState<ProfilePreviews>({});

  const activeConversations = useMemo(
    () => activeSessions.filter((session) => !["named_channel", "event_mention"].includes(session.origin)),
    [activeSessions],
  );
  const channelSessions = useMemo(
    () => activeSessions.filter((session) => session.origin === "named_channel"),
    [activeSessions],
  );
  const autoRooms = useMemo(() => {
    const rooms = activeSessions.filter((session) => session.origin === "event_mention");
    return hideDefaultAutoRooms ? rooms.filter((session) => !isDefaultAutoRoom(session)) : rooms;
  }, [activeSessions, hideDefaultAutoRooms]);

  const primaryAgentSlug =
    createMode === "direct"
      ? directParticipant
      : createMode === "group" || createMode === "channel"
        ? groupParticipants[0] || ""
        : "";

  useEffect(() => {
    let cancelled = false;
    const visibility = portalMode === "demo" ? "public" : "internal";
    void api<{ previews: ProfilePreviews }>(`/instances/profile-previews?visibility=${visibility}`)
      .then((payload) => {
        if (!cancelled) setProfilePreviews(payload.previews || {});
      })
      .catch((error) => {
        console.error("Failed to load profile previews for chat sidebar", error);
        if (!cancelled) setProfilePreviews({});
      });
    return () => {
      cancelled = true;
    };
  }, [instances, portalMode]);

  useEffect(() => {
    if (!primaryAgentSlug) {
      setModels([]);
      setModelId("");
      setModelsError("");
      setModelsLoading(false);
      return;
    }

    let cancelled = false;
    setModelsLoading(true);
    setModelsError("");
    setModels([]);
    setModelId("");

    void api<{
      models?: AgentModel[];
      default_model?: string;
      error?: string;
    }>(`/instances/${encodeURIComponent(primaryAgentSlug)}/models`)
      .then((payload) => {
        if (cancelled) return;
        const next = filterLlmCatalog(payload.models, primaryAgentSlug);
        setModels(next);
        setModelId(
          payload.default_model && next.some((m) => m.id === payload.default_model)
            ? payload.default_model
            : next[0]?.id || "",
        );
        if (payload.error) setModelsError(payload.error);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(`Failed to load models for ${primaryAgentSlug}`, error);
        setModels([]);
        setModelId("");
        setModelsError(error instanceof Error ? error.message : "Failed to load models");
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [primaryAgentSlug]);

  function resetCreateForm(nextMode: CreateMode) {
    setCreateMode(nextMode);
    setTitle("");
    setSlug("");
    setModelId("");
    setModels([]);
    setModelsError("");
    setDirectParticipant("");
    setGroupParticipants([]);
    setCreateError("");
  }

  function handleCreate() {
    void submitCreate();
  }

  async function submitCreate() {
    if (!createMode) return;

    const trimmedTitle = title.trim();
    const trimmedSlug = slug.trim();

    const participantInstanceSlugs =
      createMode === "direct"
        ? directParticipant
          ? [directParticipant]
          : []
        : groupParticipants;

    if (createMode === "direct" && participantInstanceSlugs.length !== 1) {
      setCreateError("Select an agent first.");
      return;
    }

    if ((createMode === "group" || createMode === "channel") && participantInstanceSlugs.length < 1) {
      setCreateError("Select at least one agent.");
      return;
    }

    if (createMode === "channel" && !trimmedSlug) {
      setCreateError("Channels require a slug.");
      return;
    }

    if (!modelId) {
      setCreateError(modelsLoading ? "Still loading models…" : "Select a model.");
      return;
    }

    const agent = instances.find((i) => i.slug === participantInstanceSlugs[0]);
    const generatedTitle = autoTitle({
      mode: createMode,
      agentSlug: participantInstanceSlugs[0],
      agentLabel: agent ? instanceLabel(agent).split(" (")[0] : participantInstanceSlugs[0],
      channelSlug: trimmedSlug,
      participants: participantInstanceSlugs,
    });

    try {
      await onCreateSession({
        title: trimmedTitle || generatedTitle,
        sessionType: createMode === "direct" ? "direct" : "group",
        participantInstanceSlugs,
        origin: createMode === "channel" ? "named_channel" : "human",
        slug: createMode === "channel" ? trimmedSlug : undefined,
        modelId,
      });
      resetCreateForm(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create session";
      setCreateError(message);
    }
  }

  const recentForRail = useMemo(() => {
    const all = [...activeConversations, ...channelSessions, ...autoRooms];
    return all.slice(0, 18);
  }, [activeConversations, channelSessions, autoRooms]);

  if (collapsed) {
    return (
      <aside className="chat-sidebar chat-sidebar-collapsed">
        <button
          type="button"
          className="kb-icon chat-sidebar-expand"
          title="Expand conversations"
          onClick={onToggleCollapsed}
        >
          »»
        </button>
        <Link to="/" className="chat-rail-portal" title="Portal">
          ⌂
        </Link>
        <div className="chat-rail-icons">
          {recentForRail.map((session) => {
            const pulse = sessionPulse?.[session.id];
            const busy =
              pulse?.state &&
              !["done", "cancelled", "idle"].includes(pulse.state);
            return (
              <button
                key={session.id}
                type="button"
                className={`chat-rail-icon ${selectedSessionId === session.id ? "selected" : ""}`}
                title={sectionTitle(session)}
                onClick={() => onSelectSession(session)}
              >
                <SessionAvatarBadge session={session} previews={profilePreviews} size={28} />
                {pulse?.unread ? <span className="chat-rail-unread">{pulse.unread > 9 ? "9+" : pulse.unread}</span> : null}
                {busy ? (
                  <span className="chat-rail-think" title={pulse?.state || "thinking"}>
                    {pulse?.emoji || "💭"}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="kb-icon"
          title="New DM"
          onClick={() => {
            onToggleCollapsed?.();
            resetCreateForm("direct");
          }}
        >
          +
        </button>
      </aside>
    );
  }

  return (
    <aside className="chat-sidebar">
      <div className="chat-sidebar-header">
        <div className="chat-sidebar-header-top">
          <Link to="/" className="chat-exit-portal">
            ← Portal
          </Link>
          <button
            type="button"
            className="kb-icon"
            title={drawer ? "Close conversations" : "Collapse to icon rail"}
            aria-label={drawer ? "Close conversations" : "Collapse to icon rail"}
            onClick={onToggleCollapsed}
          >
            {drawer ? "×" : "«"}
          </button>
        </div>
        <h2>Workbench</h2>
      </div>

      <div className="chat-sidebar-create">
        <div className="chat-sidebar-create-actions">
          <button type="button" className="chat-sidebar-create-btn" onClick={() => resetCreateForm("direct")}>
            DM
          </button>
          <button type="button" className="chat-sidebar-create-btn secondary" onClick={() => resetCreateForm("group")}>
            Group
          </button>
          <button type="button" className="chat-sidebar-create-btn secondary" onClick={() => resetCreateForm("channel")}>
            Channel
          </button>
        </div>

        {createMode && (
          <div className="chat-sidebar-create-form">
            <p className="muted">Creating a {createMode === "channel" ? "channel room" : createMode} session.</p>

            {createMode === "direct" && (
              <label>
                <span>Agent</span>
                <select
                  value={directParticipant}
                  onChange={(event) => setDirectParticipant(event.target.value)}
                >
                  <option value="">Choose an agent…</option>
                  {instances.map((instance) => (
                    <option key={instance.id} value={instance.slug}>
                      {instanceLabel(instance)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {createMode !== "direct" && (
              <div>
                <span className="chat-sidebar-field-label">Agents</span>
                <div className="chat-sidebar-checkboxes">
                  {instances.map((instance) => {
                    const checked = groupParticipants.includes(instance.slug);
                    return (
                      <label key={instance.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setGroupParticipants((current) => [...current, instance.slug]);
                            } else {
                              setGroupParticipants((current) =>
                                current.filter((value) => value !== instance.slug),
                              );
                            }
                          }}
                        />
                        <span>{instanceLabel(instance)}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="muted" style={{ marginTop: "0.35rem", fontSize: "0.8rem" }}>
                  Models load from the first selected agent.
                </p>
              </div>
            )}

            {createMode === "channel" && (
              <label>
                <span>Channel slug</span>
                <input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="ops-bridge"
                />
              </label>
            )}

            <label>
              <span>Model</span>
              <ModelSelect
                models={models}
                value={modelId}
                disabled={!primaryAgentSlug}
                loading={modelsLoading}
                emptyLabel={primaryAgentSlug ? "No LLM catalog" : "Select an agent first…"}
                onChange={setModelId}
              />
            </label>
            {modelsError && (
              <p className="muted" style={{ fontSize: "0.8rem" }}>
                Model list warning: {modelsError}
              </p>
            )}

            <label>
              <span>Title (optional)</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Leave empty to auto-generate"
              />
            </label>

            {createError && <p className="badge bad">{createError}</p>}

            <div className="chat-sidebar-create-footer">
              <button type="button" disabled={creating || modelsLoading} onClick={() => void handleCreate()}>
                {creating ? "Creating..." : "Create"}
              </button>
              <button type="button" className="secondary" onClick={() => resetCreateForm(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="chat-sidebar-scroll">
        <section className="chat-sidebar-section">
          <div className="chat-sidebar-section-head">
            <h3>Conversations</h3>
            <span className="chat-sidebar-count">{activeConversations.length}</span>
          </div>
          <SessionList
            sessions={activeConversations}
            selectedSessionId={selectedSessionId}
            emptyMessage="No active direct or group conversations."
            actionLabel="Archive"
            previews={profilePreviews}
            onSelectSession={onSelectSession}
            onAction={onArchiveSession}
          />
        </section>

        <section className="chat-sidebar-section">
          <div className="chat-sidebar-section-head">
            <h3>Channels</h3>
            <span className="chat-sidebar-count">{channelSessions.length}</span>
          </div>
          <SessionList
            sessions={channelSessions}
            selectedSessionId={selectedSessionId}
            emptyMessage="No named channels yet."
            actionLabel="Archive"
            previews={profilePreviews}
            onSelectSession={onSelectSession}
            onAction={onArchiveSession}
          />
        </section>

        <section className="chat-sidebar-section">
          <div className="chat-sidebar-section-head">
            <h3>Auto rooms</h3>
            <label className="chat-sidebar-hide-default">
              <input
                type="checkbox"
                checked={hideDefaultAutoRooms}
                onChange={onToggleHideDefaultAutoRooms}
              />
              Hide default
            </label>
          </div>
          <SessionList
            sessions={autoRooms}
            selectedSessionId={selectedSessionId}
            emptyMessage="No auto-created event rooms."
            actionLabel="Archive"
            previews={profilePreviews}
            onSelectSession={onSelectSession}
            onAction={onArchiveSession}
          />
        </section>

        {showArchived ? (
          <section className="chat-sidebar-section">
            <div className="chat-sidebar-section-head">
              <h3>Archived</h3>
              <span className="chat-sidebar-count">{archivedSessions.length}</span>
            </div>
            <SessionList
              sessions={archivedSessions}
              selectedSessionId={selectedSessionId}
              emptyMessage="No archived sessions."
              actionLabel="Resume"
              previews={profilePreviews}
              onSelectSession={onSelectSession}
              onAction={onResumeSession}
            />
          </section>
        ) : null}
      </div>

      <div className="chat-sidebar-archived">
        <button
          type="button"
          className="chat-sidebar-archived-toggle"
          onClick={onToggleArchived}
        >
          {showArchived ? "Hide archived" : `Archived (${archivedSessions.length})`}
        </button>
      </div>
    </aside>
  );
}
