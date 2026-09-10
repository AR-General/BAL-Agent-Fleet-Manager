import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { api } from "../../api/client";
import type { OutboxItem } from "../../lib/composerPersistence";
import { formatStatusChip } from "../../lib/agentStatusGestures";
import { EmptyState } from "../common/EmptyState";
import { ExpandableLabel } from "../common/ExpandableLabel";
import { ChatComposer, type ChatComposerApi } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { ParticipantPresenceChip } from "./ParticipantPresenceChip";
import { TtsSkipStopButtons, TtsToggleButton } from "./TtsSpeakerButtons";
import { GroupChatSettingsDialog } from "./GroupChatSettingsDialog";
import { ParticipantContextMenu } from "./ParticipantContextMenu";
import { ParticipantSpendChip } from "./ParticipantSpendChip";
import type { AgentPresence } from "../../lib/participantPresence";
import { EMPTY_TOKEN_SPEND, type SessionTokenSpend } from "../../lib/tokenSpend";
import { filterLlmCatalog, type LlmModelOption } from "../../lib/llmModels";
import { ModelSelect } from "./ModelSelect";
import {
  clampMaxToolCalls,
  MAX_TOOL_CALLS_DEFAULT,
  MAX_TOOL_CALLS_MAX,
  MAX_TOOL_CALLS_MIN,
} from "../../lib/chatToolCalls";
import type { AgentStatusEvent, ChatMessage, Session } from "./types";

type AgentModel = LlmModelOption;

type Props = {
  session?: Session;
  messages: ChatMessage[];
  connected: boolean;
  loadingMessages: boolean;
  sending: boolean;
  stopping: boolean;
  outbox: OutboxItem[];
  agentStatus?: AgentStatusEvent | null;
  /** Per-participant live agent status (group parallel replies). */
  agentStatusesBySlug?: Record<string, AgentStatusEvent>;
  composerApiRef?: MutableRefObject<ChatComposerApi | null>;
  onSend: (text: string) => void;
  onStop: () => void;
  onCancelAgent?: (slug: string) => void;
  cancellingSlugs?: Record<string, boolean>;
  onCancelOutbox: (id: string) => void;
  onRetryOutbox: (id: string) => void;
  onModelChange?: (modelId: string) => void;
  onPrimaryChange?: (slug: string) => void;
  onParticipantDoubleClick?: (slug: string) => void;
  onGroupSettingsSave?: (next: { maxAgentAutoTurns: number }) => Promise<void> | void;
  onMaxToolCallsChange?: (maxToolCalls: number) => void;
  onAddParticipant?: (slug: string) => Promise<void> | void;
  onRemoveParticipant?: (slug: string) => Promise<void> | void;
  availableAgentSlugs?: string[];
  addingParticipant?: boolean;
  removingParticipantSlug?: string | null;
  onPauseParticipant?: (slug: string, paused: boolean) => void;
  onParticipantModelChange?: (slug: string, modelId: string) => void;
  onConfigureAvatar?: (slug: string) => void;
  tokenSpend?: SessionTokenSpend;
  /** Agent slugs available for @ autocomplete (participants preferred first by caller). */
  agentSuggestions: string[];
  presenceBySlug?: Record<string, AgentPresence>;
  ttsBySlug?: Record<string, boolean>;
  ttsSpeakingSlug?: string | null;
  ttsQueueLength?: number;
  ttsReady?: boolean;
  onToggleSlugTts?: (slug: string) => void;
  onTtsCancelCurrent?: () => void;
  onTtsCancelQueue?: () => void;
  compactChrome?: boolean;
};

function sessionLabel(session?: Session): string {
  if (!session) return "No session selected";
  if (session.title?.trim()) return session.title;
  if (session.slug?.trim()) return `#${session.slug}`;
  return session.id.slice(0, 8);
}

export function ChatMain({
  session,
  messages,
  connected,
  loadingMessages,
  sending,
  stopping,
  outbox,
  agentStatus,
  agentStatusesBySlug = {},
  composerApiRef,
  onSend,
  onStop,
  onCancelAgent,
  cancellingSlugs = {},
  onCancelOutbox,
  onRetryOutbox,
  onModelChange,
  onPrimaryChange,
  onParticipantDoubleClick,
  onGroupSettingsSave,
  onMaxToolCallsChange,
  onAddParticipant,
  onRemoveParticipant,
  availableAgentSlugs = [],
  addingParticipant = false,
  removingParticipantSlug = null,
  onPauseParticipant,
  onParticipantModelChange,
  onConfigureAvatar,
  tokenSpend = EMPTY_TOKEN_SPEND,
  agentSuggestions,
  presenceBySlug = {},
  ttsBySlug = {},
  ttsSpeakingSlug = null,
  ttsQueueLength = 0,
  ttsReady = true,
  onToggleSlugTts,
  onTtsCancelCurrent,
  onTtsCancelQueue,
  compactChrome = false,
}: Props) {
  const hasStreamingMessage = messages.some((message) => message.status === "streaming");
  const participantSlugs = session?.participantInstanceSlugs ?? [];
  const primaryAgent = session?.primarySlug || participantSlugs[0] || "";
  const pausedSlugs = session?.pausedParticipantSlugs ?? [];
  const participantModels = session?.participantModels ?? {};
  const [models, setModels] = useState<AgentModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [localModelId, setLocalModelId] = useState(session?.modelId || "");
  const [localToolCalls, setLocalToolCalls] = useState(() =>
    clampMaxToolCalls(session?.maxToolCalls ?? MAX_TOOL_CALLS_DEFAULT),
  );
  const toolCallsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readFullscreen, setReadFullscreen] = useState(false);
  const [menu, setMenu] = useState<{ slug: string; x: number; y: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesWrapRef = useRef<HTMLDivElement | null>(null);
  const scrolledSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const el = messagesWrapRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom || sending || hasStreamingMessage) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, sending, hasStreamingMessage, outbox.length]);

  useEffect(() => {
    const sessionId = session?.id ?? "";
    if (!sessionId) {
      scrolledSessionRef.current = null;
      return;
    }
    if (loadingMessages) return;
    if (scrolledSessionRef.current === sessionId) return;
    const el = messagesWrapRef.current;
    if (!el) return;
    scrolledSessionRef.current = sessionId;
    const jump = () => {
      el.scrollTop = el.scrollHeight;
    };
    jump();
    const frame = requestAnimationFrame(jump);
    return () => cancelAnimationFrame(frame);
  }, [session?.id, loadingMessages, messages]);

  useEffect(() => {
    setLocalModelId(session?.modelId || "");
    setLocalToolCalls(clampMaxToolCalls(session?.maxToolCalls ?? MAX_TOOL_CALLS_DEFAULT));
    setMenu(null);
    setReadFullscreen(false);
  }, [session?.id, session?.modelId, session?.maxToolCalls]);

  useEffect(() => {
    return () => {
      if (toolCallsTimerRef.current) clearTimeout(toolCallsTimerRef.current);
    };
  }, []);

  const catalogSlugs = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const slug of [primaryAgent, ...participantSlugs]) {
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      ordered.push(slug);
    }
    return ordered;
  }, [primaryAgent, participantSlugs]);

  useEffect(() => {
    if (!catalogSlugs.length) {
      setModels([]);
      setModelsLoading(false);
      return;
    }

    let cancelled = false;
    setModelsLoading(true);

    void (async () => {
      for (const slug of catalogSlugs) {
        try {
          const payload = await api<{ models?: AgentModel[]; default_model?: string }>(
            `/instances/${encodeURIComponent(slug)}/models`,
          );
          if (cancelled) return;
          const next = filterLlmCatalog(payload.models, slug);
          if (!next.length) continue;
          setModels(next);
          const valid =
            (localModelId && next.some((m) => m.id === localModelId) && localModelId) ||
            (session?.modelId && next.some((m) => m.id === session.modelId) && session.modelId) ||
            (payload.default_model && next.some((m) => m.id === payload.default_model) && payload.default_model) ||
            next[0]?.id ||
            "";
          setLocalModelId(valid);
          return;
        } catch (error) {
          if (cancelled) return;
          console.warn(`Failed to load models for ${slug}`, error);
        }
      }
      if (!cancelled) {
        setModels([]);
        setLocalModelId("");
      }
    })().finally(() => {
      if (!cancelled) setModelsLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, catalogSlugs.join("|")]);

  function handleModelSelect(next: string) {
    setLocalModelId(next);
    onModelChange?.(next);
  }

  function commitToolCalls(raw: number) {
    const next = clampMaxToolCalls(raw);
    setLocalToolCalls(next);
    if (next === clampMaxToolCalls(session?.maxToolCalls ?? MAX_TOOL_CALLS_DEFAULT)) return;
    onMaxToolCallsChange?.(next);
  }

  function handleToolCallsInput(raw: number) {
    setLocalToolCalls(raw);
    if (toolCallsTimerRef.current) clearTimeout(toolCallsTimerRef.current);
    toolCallsTimerRef.current = setTimeout(() => commitToolCalls(raw), 500);
  }

  const liveAgent =
    Boolean(agentStatus?.state) && agentStatus?.state !== "done" && agentStatus?.state !== "cancelled";
  const anyLiveParticipant = participantSlugs.some((slug) => {
    const status = agentStatusesBySlug[slug];
    return Boolean(status?.state) && status.state !== "done" && status.state !== "cancelled";
  });
  const busy = sending || hasStreamingMessage || stopping || liveAgent || anyLiveParticipant;
  const addableSlugs = availableAgentSlugs.filter((slug) => !participantSlugs.includes(slug));
  const showRosterControls = Boolean(session && participantSlugs.length);
  const modelSummary = localModelId.split("/").pop() || "Model";

  const modelControls =
    session && primaryAgent ? (
      <div className="chat-model-stack">
        <label className="chat-model-select">
          <span className="muted">Model</span>
          <ModelSelect
            models={models}
            value={localModelId}
            disabled={stopping}
            loading={modelsLoading}
            onChange={handleModelSelect}
          />
        </label>
        {session.sessionType === "direct" ? (
          <label className="chat-model-select chat-tool-calls-select">
            <span className="muted">Tool calls</span>
            <input
              type="number"
              min={MAX_TOOL_CALLS_MIN}
              max={MAX_TOOL_CALLS_MAX}
              value={localToolCalls}
              disabled={stopping}
              title="Max tool-calling rounds before the agent must answer"
              onChange={(event) => handleToolCallsInput(Number(event.target.value))}
              onBlur={() => commitToolCalls(localToolCalls)}
            />
          </label>
        ) : null}
      </div>
    ) : null;

  return (
    <section
      className={`chat-main ${compactChrome ? "chat-main-compact" : ""} ${
        readFullscreen ? "chat-main-read-fs" : ""
      }`}
    >
      <div className="chat-main-header">
        <div>
          {compactChrome ? null : (
            <>
              <h1>{sessionLabel(session)}</h1>
              <p className="muted chat-session-origin">
                {session ? `${session.origin} · ${session.sessionType}` : "Choose a session, channel, or auto room."}
              </p>
            </>
          )}
          {participantSlugs.length ? (
            <div className="chat-participant-row" aria-label="Group participants">
              {participantSlugs.map((slug) => (
                <span key={slug} className="chat-participant-with-tts">
                  <ParticipantPresenceChip
                    slug={slug}
                    presence={presenceBySlug[slug]}
                    liveStatus={agentStatusesBySlug[slug] || null}
                    as="button"
                    active={slug === primaryAgent}
                    paused={pausedSlugs.includes(slug)}
                    onClick={() => onPrimaryChange?.(slug)}
                    onDoubleClick={() => onParticipantDoubleClick?.(slug)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({ slug, x: event.clientX, y: event.clientY });
                    }}
                    onCancel={onCancelAgent ? () => onCancelAgent(slug) : undefined}
                    cancelling={Boolean(cancellingSlugs[slug])}
                  />
                  <span className="chat-participant-tts">
                    <TtsToggleButton
                      compact
                      enabled={ttsBySlug[slug] !== false}
                      ready={ttsReady}
                      speaking={ttsSpeakingSlug === slug}
                      titleOn={`Disable TTS for @${slug}`}
                      titleOff={`Enable TTS for @${slug}`}
                      titleSpeaking={`@${slug} is speaking — click to mute`}
                      onClick={() => onToggleSlugTts?.(slug)}
                    />
                  </span>
                </span>
              ))}
              <span className="chat-participant-tts-queue" role="group" aria-label="TTS playback">
                <TtsSkipStopButtons
                  disableSkip={!ttsSpeakingSlug && ttsQueueLength === 0}
                  disableStop={!ttsSpeakingSlug && ttsQueueLength === 0}
                  onSkip={() => onTtsCancelCurrent?.()}
                  onStop={() => onTtsCancelQueue?.()}
                />
              </span>
              <ParticipantSpendChip spend={tokenSpend} participantSlugs={participantSlugs} />
              {showRosterControls && addableSlugs.length ? (
                <label className="chat-add-participant">
                  <span className="sr-only">Add participant</span>
                  <select
                    className="chat-add-participant-select"
                    value=""
                    disabled={addingParticipant}
                    aria-label="Add participant"
                    onChange={(event) => {
                      const slug = event.target.value;
                      if (slug) void onAddParticipant?.(slug);
                    }}
                  >
                    <option value="">{addingParticipant ? "Adding…" : "+ Add"}</option>
                    {addableSlugs.map((slug) => (
                      <option key={slug} value={slug}>
                        @{slug}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {showRosterControls ? (
                <button
                  type="button"
                  className="secondary chat-group-members-btn"
                  title="Add or remove participants"
                  aria-label="Add or remove participants"
                  onClick={() => setSettingsOpen(true)}
                >
                  Members
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="chat-main-status">
          {compactChrome && modelControls ? (
            <details className="chat-session-tools">
              <summary title="Model and tool-call limit">
                <span className="chat-session-tools-summary">{modelSummary}</span>
              </summary>
              {modelControls}
            </details>
          ) : (
            modelControls
          )}
          {agentStatus ? (
            <span className="badge warn chat-agent-status-chip">
              <ExpandableLabel text={formatStatusChip(agentStatus)} max={28} />
            </span>
          ) : null}
          <span className={`badge ${connected ? "ok" : "warn"} chat-ws-badge`}>
            {connected ? "WS connected" : "WS reconnecting"}
          </span>
          {busy && (
            <button type="button" className="secondary" onClick={onStop} disabled={stopping}>
              {stopping ? "Stopping..." : "Stop all"}
            </button>
          )}
        </div>
      </div>

      <div
        className="chat-main-messages card"
        ref={messagesWrapRef}
        onDoubleClick={(event) => {
          if (!compactChrome) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest("a, button, input, textarea, select, .expandable-label")) return;
          setReadFullscreen((current) => !current);
        }}
      >
        {!session && !loadingMessages && (
          <EmptyState message="Select a session from the left rail or create one to start chatting." />
        )}

        {session && loadingMessages && <p className="muted">Loading messages...</p>}

        {session && !loadingMessages && !messages.length && !outbox.length && (
          <EmptyState message="No messages yet. Send the first prompt to start the conversation." />
        )}

        <ChatMessageList messages={messages} />
        <div ref={messagesEndRef} className="chat-messages-end" />
      </div>

      {outbox.length > 0 && (
        <div className="chat-outbox card">
          <strong>Outbox</strong>
          {outbox.map((item) => (
            <div key={item.id} className="chat-outbox-item">
              <span className={`badge ${item.status === "failed" ? "bad" : "warn"}`}>
                {item.status}
              </span>
              <span className="chat-outbox-text">{item.text.slice(0, 120)}</span>
              <button type="button" className="secondary" onClick={() => onCancelOutbox(item.id)}>
                Cancel
              </button>
              {item.status === "failed" ? (
                <button type="button" onClick={() => onRetryOutbox(item.id)}>
                  Retry
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <ChatComposer
        sessionId={session?.id}
        agentSuggestions={agentSuggestions}
        participantSlugs={participantSlugs}
        sending={sending}
        stopping={stopping}
        busy={busy}
        composerApiRef={composerApiRef}
        compact={compactChrome}
        onSend={onSend}
        onStop={onStop}
      />

      {compactChrome && readFullscreen ? (
        <button
          type="button"
          className="chat-read-fs-compose"
          title="Open chat input"
          aria-label="Open chat input"
          onClick={() => {
            setReadFullscreen(false);
            requestAnimationFrame(() => composerApiRef?.current?.focus());
          }}
        >
          ✎
        </button>
      ) : null}

      <GroupChatSettingsDialog
        open={settingsOpen}
        maxAgentAutoTurns={session?.maxAgentAutoTurns ?? 5}
        replyPolicy={session?.replyPolicy}
        primarySlug={primaryAgent || null}
        participantSlugs={participantSlugs}
        availableAgentSlugs={availableAgentSlugs}
        adding={addingParticipant}
        removingSlug={removingParticipantSlug}
        onClose={() => setSettingsOpen(false)}
        onSave={async (next) => {
          await onGroupSettingsSave?.(next);
        }}
        onAddParticipant={async (slug) => {
          await onAddParticipant?.(slug);
        }}
        onRemoveParticipant={async (slug) => {
          await onRemoveParticipant?.(slug);
        }}
      />
      {menu ? (
        <ParticipantContextMenu
          slug={menu.slug}
          x={menu.x}
          y={menu.y}
          paused={pausedSlugs.includes(menu.slug)}
          currentModel={participantModels[menu.slug] || session?.modelId}
          canRemove={participantSlugs.length > 1}
          onClose={() => setMenu(null)}
          onRemove={() => {
            const slug = menu.slug;
            setMenu(null);
            onRemoveParticipant?.(slug);
          }}
          onConfigureAvatar={() => {
            const slug = menu.slug;
            setMenu(null);
            onConfigureAvatar?.(slug);
          }}
          onTogglePause={() => {
            const slug = menu.slug;
            const next = !pausedSlugs.includes(slug);
            setMenu(null);
            onPauseParticipant?.(slug, next);
          }}
          onSelectModel={(modelId) => {
            onParticipantModelChange?.(menu.slug, modelId);
          }}
        />
      ) : null}
    </section>
  );
}
