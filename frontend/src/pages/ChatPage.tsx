import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, type DbInstance } from "../api/client";
import { ChatMain } from "../components/chat/ChatMain";
import { EventsPanel } from "../components/chat/EventsPanel";
import { MarkdownEditor } from "../components/chat/MarkdownEditor";
import { MultiAvatarViewport } from "../components/chat/MultiAvatarViewport";
import { SessionSidebar } from "../components/chat/SessionSidebar";
import type {
  AgentStatusEvent,
  ChatMessage,
  FleetEvent,
  MessageReaction,
  Session,
  ToolCallVisual,
} from "../components/chat/types";
import { VoiceDock } from "../components/chat/VoiceDock";
import { useChatWebSocket } from "../hooks/useWebSocket";
import { useMediaQuery, useVisualViewportHeight } from "../hooks/useMediaQuery";
import { useParticipantPresence } from "../hooks/useParticipantPresence";
import { useScenePopout } from "../hooks/useScenePopout";
import { isScenePopoutPath } from "../lib/scenePopout";
import { collectViewportToolEvents } from "../lib/toolActionToasts";
import { ttsMessageContent } from "../lib/displayMessageContent";
import { DEFAULT_FISH_VOICE_ID, presenceFishVoiceId, resolveFishVoiceId } from "../lib/fishVoices";
import { collectCompletedAssistantIds } from "../lib/ttsHistorySkip";
import type { TtsQueueState, TtsSpeakSource } from "../hooks/useStreamingTts";
import {
  DEFAULT_TTS_SPEAK_MODE,
  resolveEffectiveTtsSpeakMode,
  type TtsSpeakMode,
  workspaceTtsSpeakMode,
} from "../lib/ttsSpeakMode";
import type { ChatComposerApi } from "../components/chat/ChatComposer";
import {
  enqueueOutbox,
  removeOutboxItem,
  sessionOutbox,
  updateOutboxItem,
  type OutboxItem,
} from "../lib/composerPersistence";
import { EMPTY_TOKEN_SPEND, normalizeTokenSpend, type SessionTokenSpend } from "../lib/tokenSpend";
import { clampMaxToolCalls } from "../lib/chatToolCalls";
import { coalesceAgentStatusPhase } from "../lib/agentStatusGestures";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeSession(value: unknown): Session {
  const record = isRecord(value) ? value : {};

  return {
    id: asString(record.id) ?? `session-${Date.now()}`,
    title: asString(record.title),
    slug: asString(record.slug),
    status: asString(record.status) ?? "active",
    origin: asString(record.origin) ?? "human",
    sessionType: asString(record.sessionType ?? record.session_type) ?? "direct",
    modelId: asString(record.modelId ?? record.model_id),
    pinned: asBoolean(record.pinned),
    participantInstanceSlugs: asStringArray(
      record.participantInstanceSlugs ?? record.participant_instance_slugs,
    ),
    replyPolicy: asString(record.replyPolicy ?? record.reply_policy) ?? "human_only",
    primaryInstanceId: asString(record.primaryInstanceId ?? record.primary_instance_id),
    primarySlug: asString(record.primarySlug ?? record.primary_slug),
    maxAgentAutoTurns: (() => {
      const raw = record.maxAgentAutoTurns ?? record.max_agent_auto_turns;
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? Math.min(20, Math.max(1, Math.floor(n))) : 5;
    })(),
    maxToolCalls: clampMaxToolCalls(record.maxToolCalls ?? record.max_tool_calls),
    pausedParticipantSlugs: asStringArray(
      record.pausedParticipantSlugs ?? record.paused_participant_slugs,
    ),
    participantModels: (() => {
      const raw = record.participantModels ?? record.participant_models;
      if (!isRecord(raw)) return {};
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        const id = asString(value);
        if (id) out[key] = id;
      }
      return out;
    })(),
    updatedAt: asString(record.updatedAt ?? record.updated_at),
    createdAt: asString(record.createdAt ?? record.created_at),
  };
}

function normalizeReaction(value: unknown): MessageReaction | null {
  const record = isRecord(value) ? value : {};
  const kind = asString(record.kind);
  const slug = asString(record.slug);
  if (!kind || !slug) return null;
  if (kind !== "acknowledged" && kind !== "ignoring" && kind !== "responding") return null;
  return {
    messageId: asString(record.messageId ?? record.message_id) ?? "",
    instanceId: asString(record.instanceId ?? record.instance_id) ?? "",
    slug,
    kind,
    updatedAt: asString(record.updatedAt ?? record.updated_at) ?? undefined,
  };
}

function normalizeMessage(value: unknown, fallbackStatus: ChatMessage["status"] = "done"): ChatMessage {
  const record = isRecord(value) ? value : {};
  const reactionsRaw = Array.isArray(record.reactions) ? record.reactions : [];
  const reactions = reactionsRaw
    .map(normalizeReaction)
    .filter((r): r is MessageReaction => Boolean(r));

  return {
    id: asString(record.id ?? record.message_id) ?? `message-${Date.now()}`,
    sessionId: asString(record.sessionId ?? record.session_id) ?? undefined,
    role: asString(record.role) ?? "assistant",
    authorType: asString(record.authorType ?? record.author_type) ?? "system",
    authorSlug: asString(record.authorSlug ?? record.author_slug) ?? undefined,
    content: typeof record.content === "string" ? record.content : "",
    createdAt: asString(record.createdAt ?? record.created_at) ?? new Date().toISOString(),
    status: fallbackStatus,
    reactions: reactions.length ? reactions : undefined,
  };
}

function normalizeFleetEvent(value: unknown): FleetEvent {
  const record = isRecord(value) ? value : {};
  const data = isRecord(record.data) ? record.data : {};

  return {
    id: asString(record.id) ?? `event-${Date.now()}`,
    eventType: asString(record.eventType ?? record.event_type) ?? "fleet_event",
    summary: asString(record.summary),
    tags: asStringArray(record.tags),
    data,
    relatedSessionId: asString(record.relatedSessionId ?? record.related_session_id),
    createdAt: asString(record.createdAt ?? record.created_at) ?? new Date().toISOString(),
  };
}

function normalizeSessionList(payload: unknown): Session[] {
  if (Array.isArray(payload)) {
    return payload.map(normalizeSession);
  }

  if (isRecord(payload) && Array.isArray(payload.sessions)) {
    return payload.sessions.map(normalizeSession);
  }

  return [];
}

function normalizeMessageList(payload: unknown): ChatMessage[] {
  if (Array.isArray(payload)) {
    return payload.map((message) => normalizeMessage(message, "done"));
  }

  if (isRecord(payload) && Array.isArray(payload.messages)) {
    return payload.messages.map((message) => normalizeMessage(message, "done"));
  }

  return [];
}

function normalizeEventList(payload: unknown): FleetEvent[] {
  if (Array.isArray(payload)) {
    return payload.map(normalizeFleetEvent);
  }

  if (isRecord(payload) && Array.isArray(payload.events)) {
    return payload.events.map(normalizeFleetEvent);
  }

  return [];
}

function upsertMessage(messages: ChatMessage[], nextMessage: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === nextMessage.id);
  if (index === -1) {
    return [...messages, nextMessage];
  }

  const updated = [...messages];
  updated[index] = { ...updated[index], ...nextMessage };
  return updated;
}

function mergeMessagesAfterSync(
  persisted: ChatMessage[],
  current: ChatMessage[],
  generating: boolean,
  streamMessage?: ChatMessage | null,
): ChatMessage[] {
  if (generating && streamMessage) {
    return upsertMessage(persisted, streamMessage);
  }
  const ephemeral = current.filter(
    (message) => message.status === "streaming" && message.id.startsWith("stream-"),
  );
  if (generating) {
    let next = persisted;
    for (const message of ephemeral) next = upsertMessage(next, message);
    return next;
  }
  const kept = ephemeral.filter(
    (message) =>
      !persisted.some(
        (row) => row.role === "assistant" && (row.createdAt || "") >= (message.createdAt || ""),
      ),
  );
  let next = persisted;
  for (const message of kept) next = upsertMessage(next, { ...message, status: "done" });
  return next;
}

function sessionBarLabel(session?: Session): string {
  if (!session) return "Chat";
  if (session.title?.trim()) return session.title;
  if (session.slug?.trim()) return `#${session.slug}`;
  return session.id.slice(0, 8);
}

function touchSessionList(
  sessions: Session[],
  sessionId: string,
  updatedAt: string,
  forceStatus?: Session["status"],
): Session[] {
  const index = sessions.findIndex((session) => session.id === sessionId);
  if (index === -1) return sessions;

  const next = [...sessions];
  const [session] = next.splice(index, 1);
  next.unshift({
    ...session,
    updatedAt,
    status: forceStatus ?? session.status,
  });
  return next;
}

export function ChatPage() {
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isScenePopout = isScenePopoutPath(location.pathname);
  const sendAbortRef = useRef<AbortController | null>(null);
  const joinedSessionsRef = useRef<Set<string>>(new Set());
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<Session[]>([]);
  const [instances, setInstances] = useState<DbInstance[]>([]);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(routeSessionId);
  const [notesValue, setNotesValue] = useState("");
  const composerApiRef = useRef<ChatComposerApi | null>(null);
  const [activeSideTab, setActiveSideTab] = useState<"events" | "notes" | "viewport">("viewport");
  const [sceneLookAt, setSceneLookAt] = useState<{ slug: string; token: number } | null>(null);
  const [avatarConfigRequest, setAvatarConfigRequest] = useState<{ slug: string; token: number } | null>(
    null,
  );
  const [tokenSpend, setTokenSpend] = useState<SessionTokenSpend>(EMPTY_TOKEN_SPEND);
  const [ttsBySlug, setTtsBySlug] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("oc-chat-voice-tts-slugs");
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [ttsQueueState, setTtsQueueState] = useState<TtsQueueState>({
    speaking: false,
    speakingSlug: null,
    queueLength: 0,
  });
  const ttsControlsRef = useRef<{
    cancelCurrent: () => void;
    cancelQueue: () => void;
    speakNow: (text: string, opts?: { slug?: string; messageId?: string; voiceId?: string }) => void;
    remapMessageId: (oldId: string, newId: string) => void;
  } | null>(null);
  const [historyTtsIds, setHistoryTtsIds] = useState<Record<string, true>>({});
  const [ttsHistorySession, setTtsHistorySession] = useState("");
  const [pageError, setPageError] = useState("");
  const [eventsError, setEventsError] = useState("");
  const [voiceBySlug, setVoiceBySlug] = useState<Record<string, string>>({});
  const voiceBySlugRef = useRef(voiceBySlug);
  voiceBySlugRef.current = voiceBySlug;
  const [presenceSettingsBySlug, setPresenceSettingsBySlug] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [workspaceSpeakMode, setWorkspaceSpeakMode] = useState<TtsSpeakMode>(DEFAULT_TTS_SPEAK_MODE);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [removingParticipantSlug, setRemovingParticipantSlug] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [hideDefaultAutoRooms, setHideDefaultAutoRooms] = useState(true);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatusEvent | null>(null);
  const [agentStatusesBySlug, setAgentStatusesBySlug] = useState<Record<string, AgentStatusEvent>>({});
  const [cancellingSlugs, setCancellingSlugs] = useState<Record<string, boolean>>({});
  const isMobileChat = useMediaQuery("(max-width: 860px)");
  useVisualViewportHeight(isMobileChat);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobilePaneOpen, setMobilePaneOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("oc-chat-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [rightWidth, setRightWidth] = useState(() => {
    try {
      const n = Number(localStorage.getItem("oc-chat-right-width"));
      return Number.isFinite(n) && n >= 280 && n <= 720 ? n : 380;
    } catch {
      return 380;
    }
  });
  const [sessionPulse, setSessionPulse] = useState<
    Record<string, { unread?: number; emoji?: string; state?: string }>
  >({});
  const outboxPumpRef = useRef(false);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingReactionsRef = useRef<Map<string, MessageReaction[]>>(new Map());
  messagesRef.current = messages;

  function mergePendingReactions(message: ChatMessage): ChatMessage {
    const pending = pendingReactionsRef.current.get(message.id);
    if (!pending?.length) return message;
    pendingReactionsRef.current.delete(message.id);
    const bySlug = new Map((message.reactions || []).map((r) => [r.slug, r]));
    for (const r of pending) bySlug.set(r.slug, r);
    return { ...message, reactions: [...bySlug.values()] };
  }

  const selectedSession = useMemo(
    () =>
      [...activeSessions, ...archivedSessions].find((session) => session.id === selectedSessionId),
    [activeSessions, archivedSessions, selectedSessionId],
  );
  const noteKey = useMemo(
    () => `oc-chat-workbench:${selectedSessionId ?? "global"}.md`,
    [selectedSessionId],
  );
  const latestDoneAssistant = useMemo(
    () =>
      [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            typeof message.content === "string" &&
            message.content.trim() &&
            message.status !== "streaming" &&
            message.status !== "sending" &&
            message.status !== "queued",
        ),
    [messages],
  );
  const latestAssistant = useMemo(
    () =>
      [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            typeof message.content === "string" &&
            message.content.trim() &&
            message.status !== "sending" &&
            message.status !== "queued" &&
            message.status !== "failed",
        ),
    [messages],
  );
  const viewportToolEvents = useMemo(() => collectViewportToolEvents(messages), [messages]);

  const presenceBySlug = useParticipantPresence(
    selectedSession?.participantInstanceSlugs ?? [],
    instances,
  );
  const speakingSlug =
    latestAssistant?.authorSlug || selectedSession?.participantInstanceSlugs[0] || "";
  const selectedVoiceId = speakingSlug ? voiceBySlug[speakingSlug] || null : null;
  const ttsSpeakText = latestAssistant?.content
    ? ttsMessageContent(latestAssistant.content)
    : undefined;
  const ttsStreaming = latestAssistant?.status === "streaming";

  useEffect(() => {
    try {
      localStorage.setItem("oc-chat-voice-tts-slugs", JSON.stringify(ttsBySlug));
    } catch {
      /* ignore */
    }
  }, [ttsBySlug]);

  const ttsSources = useMemo((): TtsSpeakSource[] => {
    const slugs = selectedSession?.participantInstanceSlugs ?? [];
    const historyReady = ttsHistorySession === selectedSessionId;
    const latest = new Map<string, ChatMessage>();
    for (const message of messages) {
      if (message.role !== "assistant" || !message.authorSlug) continue;
      if (selectedSessionId && message.sessionId && message.sessionId !== selectedSessionId) continue;
      latest.set(message.authorSlug, message);
    }
    const sources: TtsSpeakSource[] = [];
    for (const slug of slugs) {
      const message = latest.get(slug);
      if (!message?.id) continue;
      const streamingMsg = message.status === "streaming";
      if (!streamingMsg && (!historyReady || historyTtsIds[message.id])) continue;
      const speakMode = resolveEffectiveTtsSpeakMode({
        presenceSettings: presenceSettingsBySlug[slug],
        workspaceMode: workspaceSpeakMode,
      });
      sources.push({
        slug,
        enabled: ttsBySlug[slug] !== false,
        text: ttsMessageContent(message.content),
        performanceText: message.content,
        messageId: message.id,
        streaming: streamingMsg,
        voiceId: resolveFishVoiceId(voiceBySlug[slug], DEFAULT_FISH_VOICE_ID),
        speakMode,
      });
    }
    return sources;
  }, [
    historyTtsIds,
    messages,
    presenceSettingsBySlug,
    selectedSession?.participantInstanceSlugs,
    selectedSessionId,
    ttsBySlug,
    ttsHistorySession,
    voiceBySlug,
    workspaceSpeakMode,
  ]);

  const handleTtsControls = useCallback(
    (ctl: {
      cancelCurrent: () => void;
      cancelQueue: () => void;
      speakNow: (text: string, opts?: { slug?: string; messageId?: string; voiceId?: string }) => void;
      remapMessageId: (oldId: string, newId: string) => void;
    }) => {
      ttsControlsRef.current = ctl;
    },
    [],
  );

  const handleWorkspaceSpeakModeChange = useCallback(async (mode: TtsSpeakMode) => {
    setWorkspaceSpeakMode(mode);
    try {
      await api("/workspace-settings", {
        method: "PUT",
        body: JSON.stringify({ tts_speak_mode: mode }),
      });
    } catch (error) {
      console.warn("Failed to save workspace speak mode", error);
    }
  }, []);

  const appendComposerTranscript = useCallback((transcript: string) => {
    composerApiRef.current?.appendTranscript(transcript);
  }, []);

  const scenePopout = useScenePopout({
    sessionId: selectedSessionId,
    role: isScenePopout ? "scene" : "chat",
    onLookAt: (slug, token) => setSceneLookAt({ slug, token }),
    onConfig: (slug, token) => setAvatarConfigRequest({ slug, token }),
    onTranscript: appendComposerTranscript,
    onTtsCancelCurrent: () => ttsControlsRef.current?.cancelCurrent(),
    onTtsCancelQueue: () => ttsControlsRef.current?.cancelQueue(),
    onTtsQueueState: setTtsQueueState,
  });

  const loadSessions = useCallback(async () => {
    try {
      const [activePayload, archivedPayload] = await Promise.all([
        api<unknown>("/chat/sessions?status=active"),
        api<unknown>("/chat/sessions?status=archived"),
      ]);

      setActiveSessions(normalizeSessionList(activePayload));
      setArchivedSessions(normalizeSessionList(archivedPayload));
    } catch (error) {
      console.error("Failed to load chat sessions", error);
      setPageError(error instanceof Error ? error.message : "Failed to load sessions");
    }
  }, []);

  const loadInstances = useCallback(async () => {
    try {
      const payload = await api<{ instances?: DbInstance[] } | DbInstance[]>("/instances");
      const nextInstances = Array.isArray(payload) ? payload : payload.instances ?? [];
      setInstances(nextInstances);
    } catch (error) {
      console.error("Failed to load instances", error);
      setPageError(error instanceof Error ? error.message : "Failed to load instances");
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    setEventsError("");

    try {
      const payload = await api<unknown>("/events/feed?limit=40");
      setEvents(normalizeEventList(payload));
    } catch (primaryError) {
      try {
        const fallbackPayload = await api<unknown>("/chat/events?limit=40");
        setEvents(normalizeEventList(fallbackPayload));
      } catch (fallbackError) {
        console.error("Failed to load event feed", primaryError, fallbackError);
        setEventsError(fallbackError instanceof Error ? fallbackError.message : "Failed to load events");
      }
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingMessages(true);
    try {
      const payload = await api<unknown>(`/chat/sessions/${sessionId}/messages`);
      const persisted = normalizeMessageList(payload);
      setMessages((current) => {
        const streaming = current.filter((message) => message.status === "streaming");
        let next = persisted;
        for (const message of streaming) {
          if (!next.some((row) => row.id === message.id)) {
            next = upsertMessage(next, message);
          }
        }
        return next;
      });
      if (!opts?.silent) {
        setHistoryTtsIds(collectCompletedAssistantIds(persisted, sessionId));
        setTtsHistorySession(sessionId);
      }
    } catch (error) {
      console.error("Failed to load chat messages", error);
      if (!opts?.silent) {
        setPageError(error instanceof Error ? error.message : "Failed to load messages");
        setMessages([]);
        setHistoryTtsIds({});
        setTtsHistorySession(sessionId);
      }
    } finally {
      if (!opts?.silent) setLoadingMessages(false);
    }
  }, []);

  const loadUsage = useCallback(async (sessionId: string) => {
    try {
      const payload = await api<unknown>(`/chat/sessions/${sessionId}/usage`);
      setTokenSpend(normalizeTokenSpend(payload));
    } catch (error) {
      console.warn("Failed to load session token usage", error);
    }
  }, []);

  const reloadNotes = useCallback(() => {
    try {
      setNotesValue(localStorage.getItem(noteKey) ?? "");
    } catch (error) {
      console.error("Failed to read chat notes", error);
    }
  }, [noteKey]);

  const saveNotes = useCallback(() => {
    setNotesSaving(true);
    try {
      localStorage.setItem(noteKey, notesValue);
    } catch (error) {
      console.error("Failed to save chat notes", error);
      setPageError("Failed to save notes");
    } finally {
      setNotesSaving(false);
    }
  }, [noteKey, notesValue]);

  const ensureJoinedSession = useCallback(
    async (session: Session) => {
      if (!["named_channel", "event_mention"].includes(session.origin)) return;
      if (joinedSessionsRef.current.has(session.id)) return;

      try {
        await api(`/chat/sessions/${session.id}/join`, { method: "POST" });
        joinedSessionsRef.current.add(session.id);
      } catch (error) {
        console.error(`Failed to join session ${session.id}`, error);
      }
    },
    [],
  );

  useEffect(() => {
    void Promise.all([loadSessions(), loadInstances(), loadEvents()]);
  }, [loadEvents, loadInstances, loadSessions]);

  useEffect(() => {
    setSelectedSessionId(routeSessionId);
  }, [routeSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      pendingReactionsRef.current.clear();
      setMessages([]);
      setOutbox([]);
      setAgentStatus(null);
      setAgentStatusesBySlug({});
      setCancellingSlugs({});
      setTokenSpend(EMPTY_TOKEN_SPEND);
      setHistoryTtsIds({});
      setTtsHistorySession("");
      return;
    }

    pendingReactionsRef.current.clear();
    setOutbox(sessionOutbox(selectedSessionId));
    setAgentStatus(null);
    setAgentStatusesBySlug({});
    setCancellingSlugs({});
    setSceneLookAt(null);
    void loadMessages(selectedSessionId);
    void loadUsage(selectedSessionId);
  }, [loadMessages, loadUsage, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setSessionPulse((current) => {
      if (!current[selectedSessionId]) return current;
      const next = { ...current };
      next[selectedSessionId] = { ...next[selectedSessionId], unread: 0 };
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    try {
      localStorage.setItem("oc-chat-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!isMobileChat) {
      setMobileNavOpen(false);
      setMobilePaneOpen(false);
      return;
    }
    if (!selectedSessionId) setMobileNavOpen(true);
  }, [isMobileChat, selectedSessionId]);

  useEffect(() => {
    if (!isMobileChat) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMobileNavOpen(false);
      setMobilePaneOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobileChat]);

  useEffect(() => {
    const overlayOpen = isMobileChat && (mobileNavOpen || mobilePaneOpen);
    document.body.classList.toggle("chat-mobile-overlay", overlayOpen);
    return () => document.body.classList.remove("chat-mobile-overlay");
  }, [isMobileChat, mobileNavOpen, mobilePaneOpen]);

  useEffect(() => {
    try {
      localStorage.setItem("oc-chat-right-width", String(rightWidth));
    } catch {
      /* ignore */
    }
  }, [rightWidth]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!resizeRef.current) return;
      const dx = resizeRef.current.startX - e.clientX;
      const next = Math.min(720, Math.max(280, resizeRef.current.startW + dx));
      setRightWidth(next);
    }
    function onUp() {
      resizeRef.current = null;
      document.body.classList.remove("chat-resizing");
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    const active = isScenePopout || scenePopout.popped || activeSideTab === "viewport";
    void api(`/chat/sessions/${selectedSessionId}/viewport`, {
      method: "PUT",
      body: JSON.stringify({ active }),
    }).catch((error) => {
      console.warn("Failed to sync viewport flag", error);
    });
    return () => {
      if (isScenePopout) return;
      void api(`/chat/sessions/${selectedSessionId}/viewport`, {
        method: "PUT",
        body: JSON.stringify({ active: false }),
      }).catch(() => undefined);
    };
  }, [activeSideTab, isScenePopout, scenePopout.popped, selectedSessionId]);

  useEffect(() => {
    reloadNotes();
  }, [reloadNotes]);

  useEffect(() => {
    if (selectedSession) {
      void ensureJoinedSession(selectedSession);
    }
  }, [ensureJoinedSession, selectedSession]);

  useEffect(() => {
    let cancelled = false;
    void api<{ settings?: { tts_speak_mode?: string } }>("/workspace-settings")
      .then((payload) => {
        if (cancelled) return;
        setWorkspaceSpeakMode(workspaceTtsSpeakMode(payload.settings || {}));
      })
      .catch((error) => {
        console.warn("Failed to load workspace settings", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const slugs = selectedSession?.participantInstanceSlugs ?? [];
    if (!slugs.length) {
      setVoiceBySlug({});
      setPresenceSettingsBySlug({});
      return;
    }

    let cancelled = false;

    void Promise.all(
      slugs.map(async (slug) => {
        try {
          const payload = await api<{
            presence?: {
              fishVoiceId?: string | null;
              fish_voice_id?: string | null;
              settings?: Record<string, unknown> | null;
            } | null;
          }>(`/presence/${encodeURIComponent(slug)}`);
          return [
            slug,
            presenceFishVoiceId(payload.presence),
            (payload.presence?.settings && typeof payload.presence.settings === "object"
              ? payload.presence.settings
              : {}) as Record<string, unknown>,
          ] as const;
        } catch (error) {
          console.warn(`Failed to load presence voice for ${slug}`, error);
          return [slug, "", {}] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setVoiceBySlug(Object.fromEntries(entries.map(([slug, voice]) => [slug, voice])));
      setPresenceSettingsBySlug(
        Object.fromEntries(entries.map(([slug, , settings]) => [slug, settings])),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [selectedSession]);

  const handleSocketMessage = useCallback(
    (payload: unknown) => {
      const record = isRecord(payload) ? payload : {};
      const type = asString(record.type);
      const eventSessionId = asString(record.session_id ?? record.sessionId);

      if (type === "ws_open") {
        void loadSessions();
        void loadEvents();
        return;
      }

      if (type === "ws_close" || type === "connected" || type === "subscribed" || type === "pong") {
        return;
      }

      if (type === "session_sync") {
        const generating = asBoolean(record.generating);
        const statusRec = isRecord(record.agent_status)
          ? record.agent_status
          : isRecord(record.agentStatus)
            ? record.agentStatus
            : null;
        const streamRec = isRecord(record.stream) ? record.stream : null;
        const statusesRec = isRecord(record.agent_statuses)
          ? record.agent_statuses
          : isRecord(record.agentStatuses)
            ? record.agentStatuses
            : null;
        const sid = eventSessionId || selectedSessionId;

        if (sid && sid !== selectedSessionId) {
          if (generating) {
            setSessionPulse((current) => ({
              ...current,
              [sid]: {
                ...current[sid],
                state: asString(statusRec?.state) || current[sid]?.state || "thinking",
                emoji: asString(statusRec?.emoji) || current[sid]?.emoji,
              },
            }));
          }
          return;
        }

        if (statusesRec) {
          const next: Record<string, AgentStatusEvent> = {};
          for (const [key, value] of Object.entries(statusesRec)) {
            if (!isRecord(value)) continue;
            const slug = asString(value.author_slug ?? value.authorSlug) || key;
            if (slug === "_") continue;
            next[slug] = {
              state: asString(value.state) || "thinking",
              emoji: asString(value.emoji) || undefined,
              label: asString(value.label) || undefined,
              authorSlug: slug,
            };
          }
          setAgentStatusesBySlug(next);
        }

        if (generating && statusRec) {
          setAgentStatus({
            state: asString(statusRec.state) || "thinking",
            emoji: asString(statusRec.emoji) || undefined,
            label: asString(statusRec.label) || undefined,
            authorSlug: asString(statusRec.author_slug ?? statusRec.authorSlug) || undefined,
          });
          setStreaming(true);
        } else {
          setAgentStatus(null);
          setStreaming(false);
          if (!generating) setAgentStatusesBySlug({});
        }

        if (!sid) return;
        void (async () => {
          try {
            const payloadMessages = await api<unknown>(`/chat/sessions/${sid}/messages`);
            const persisted = normalizeMessageList(payloadMessages);
            const streamMessage =
              generating && streamRec
                ? normalizeMessage(
                    {
                      id: streamRec.message_id ?? streamRec.messageId,
                      role: streamRec.role || "assistant",
                      author_type: streamRec.author_type ?? streamRec.authorType ?? "instance",
                      author_slug: streamRec.author_slug ?? streamRec.authorSlug,
                      content: typeof streamRec.content === "string" ? streamRec.content : "",
                    },
                    "streaming",
                  )
                : null;
            setMessages((current) => mergeMessagesAfterSync(persisted, current, generating, streamMessage));
          } catch (error) {
            console.warn("Failed to resync messages after session_sync", error);
            if (!generating) {
              setMessages((current) =>
                current.map((message) =>
                  message.status === "streaming" ? { ...message, status: "done" } : message,
                ),
              );
            }
          }
        })();
        return;
      }

      if (type === "fleet_event") {
        const nextEvent = normalizeFleetEvent(record);
        setEvents((current) => {
          const withoutExisting = current.filter((event) => event.id !== nextEvent.id);
          return [nextEvent, ...withoutExisting].slice(0, 40);
        });
        return;
      }

      if (!type || !eventSessionId) return;

      setActiveSessions((current) =>
        touchSessionList(
          current,
          eventSessionId,
          asString(record.created_at ?? record.createdAt) ?? new Date().toISOString(),
        ),
      );
      setArchivedSessions((current) =>
        current.map((session) =>
          session.id === eventSessionId
            ? {
                ...session,
                updatedAt: asString(record.created_at ?? record.createdAt) ?? new Date().toISOString(),
              }
            : session,
        ),
      );

      if (eventSessionId !== selectedSessionId) {
        if (type === "agent_status") {
          const state = asString(record.state) || "thinking";
          setSessionPulse((current) => ({
            ...current,
            [eventSessionId]: {
              ...current[eventSessionId],
              state,
              emoji: asString(record.emoji) || current[eventSessionId]?.emoji,
              unread: current[eventSessionId]?.unread || 0,
            },
          }));
          return;
        }
        if (type === "message" || type === "message_done" || type === "message_delta") {
          setSessionPulse((current) => ({
            ...current,
            [eventSessionId]: {
              ...current[eventSessionId],
              unread: (current[eventSessionId]?.unread || 0) + (type === "message_delta" ? 0 : 1),
              state: type === "message_delta" ? "streaming" : current[eventSessionId]?.state,
            },
          }));
        }
        return;
      }

      if (type === "session_model") {
        const modelId = asString(record.model_id);
        const slug = asString(record.slug);
        const sid = eventSessionId || selectedSessionId;
        if (!modelId || !sid) return;
        const patchSession = (session: Session): Session => {
          if (session.id !== sid) return session;
          const participantModels = { ...(session.participantModels || {}) };
          if (slug) participantModels[slug] = modelId;
          return { ...session, modelId, participantModels };
        };
        setActiveSessions((current) => current.map(patchSession));
        setArchivedSessions((current) => current.map(patchSession));
        return;
      }

      if (type === "session_stopped") {
        setMessages((current) =>
          current.map((message) =>
            message.status === "streaming" ? { ...message, status: "done" } : message,
          ),
        );
        setAgentStatus({ state: "cancelled", emoji: "⏹️", label: "cancelled" });
        setAgentStatusesBySlug((current) => {
          const next: Record<string, AgentStatusEvent> = {};
          for (const [slug, status] of Object.entries(current)) {
            next[slug] = { ...status, state: "cancelled", emoji: "⏹️", label: "cancelled" };
          }
          return next;
        });
        setCancellingSlugs({});
        setSending(false);
        setStreaming(false);
        setStopping(false);
        return;
      }

      if (type === "agent_status") {
        const rawState = asString(record.state) || "thinking";
        const nextStatus: AgentStatusEvent = {
          state: coalesceAgentStatusPhase(rawState),
          emoji: asString(record.emoji) || undefined,
          label: asString(record.label) || undefined,
          authorSlug: asString(record.author_slug) || undefined,
        };
        setAgentStatus((prev) => {
          if (
            prev &&
            prev.state === nextStatus.state &&
            prev.authorSlug === nextStatus.authorSlug &&
            nextStatus.state !== "done" &&
            nextStatus.state !== "cancelled"
          ) {
            // Ignore label/emoji churn from tool_progress (would re-render the whole chat).
            return prev;
          }
          return nextStatus;
        });
        const slug = nextStatus.authorSlug;
        if (slug) {
          setAgentStatusesBySlug((current) => {
            const prev = current[slug];
            if (
              prev &&
              prev.state === nextStatus.state &&
              nextStatus.state !== "done" &&
              nextStatus.state !== "cancelled"
            ) {
              return current;
            }
            return { ...current, [slug]: nextStatus };
          });
          if (nextStatus.state === "cancelled" || nextStatus.state === "done") {
            setCancellingSlugs((current) => {
              if (!current[slug]) return current;
              const next = { ...current };
              delete next[slug];
              return next;
            });
          }
        } else if (nextStatus.state === "cancelled") {
          setAgentStatusesBySlug((current) => {
            const next: Record<string, AgentStatusEvent> = {};
            for (const [key, status] of Object.entries(current)) {
              next[key] = { ...status, state: "cancelled", emoji: "⏹️", label: "cancelled" };
            }
            return next;
          });
          setCancellingSlugs({});
        }
        const state = nextStatus.state;
        if (state === "done" || state === "cancelled") {
          setStreaming((current) => {
            return messagesRef.current.some((m) => m.status === "streaming") ? true : false;
          });
        } else {
          setStreaming(true);
        }
        return;
      }

      if (type === "message_reaction") {
        const reaction = normalizeReaction(record);
        const messageId = asString(record.message_id);
        if (!reaction || !messageId) return;
        const nextReaction = { ...reaction, messageId };
        setMessages((current) => {
          const idx = current.findIndex((message) => message.id === messageId);
          if (idx < 0) {
            const pending = pendingReactionsRef.current.get(messageId) || [];
            const others = pending.filter((r) => r.slug !== nextReaction.slug);
            pendingReactionsRef.current.set(messageId, [...others, nextReaction]);
            return current;
          }
          return current.map((message) => {
            if (message.id !== messageId) return message;
            const others = (message.reactions || []).filter((r) => r.slug !== nextReaction.slug);
            return {
              ...message,
              reactions: [...others, nextReaction],
            };
          });
        });
        return;
      }

      if (type === "speak") {
        const text = asString(record.text);
        const authorSlug = asString(record.author_slug) || undefined;
        const messageId = asString(record.message_id) || undefined;
        if (text) {
          if (!ttsControlsRef.current?.speakNow) {
            console.warn("[tts] speak event dropped — voice dock not mounted (open 3D tab + enable TTS)", {
              authorSlug,
              chars: text.length,
            });
          } else {
            ttsControlsRef.current.speakNow(text, {
              slug: authorSlug,
              messageId,
              voiceId: authorSlug
                ? resolveFishVoiceId(voiceBySlugRef.current[authorSlug], DEFAULT_FISH_VOICE_ID)
                : undefined,
            });
          }
        }
        return;
      }

      if (type === "tool_progress" || type === "tool_call") {
        const streamId = asString(record.message_id);
        const toolCall: ToolCallVisual = {
          id:
            asString(record.tool_call_id) ||
            `${asString(record.tool) || "tool"}-${asString(record.label) || Date.now()}`,
          tool: asString(record.tool) || undefined,
          emoji: asString(record.emoji) || undefined,
          label: asString(record.label) || undefined,
          status: asString(record.status) || "running",
          arguments: asString(record.arguments) || undefined,
        };
        if (streamId) {
          setMessages((current) => {
            const existing = current.find((m) => m.id === streamId);
            if (!existing) {
              return upsertMessage(current, {
                id: streamId,
                role: "assistant",
                authorType: "instance",
                authorSlug: asString(record.author_slug) || undefined,
                content: "",
                createdAt: new Date().toISOString(),
                status: "streaming",
                toolCalls: [toolCall],
              });
            }
            const calls = [...(existing.toolCalls || [])];
            const idx = calls.findIndex((c) => c.id === toolCall.id);
            if (idx >= 0) calls[idx] = { ...calls[idx], ...toolCall };
            else calls.push(toolCall);
            return upsertMessage(current, { ...existing, toolCalls: calls });
          });
        }
        // Do NOT setAgentStatus here — the gateway already emits agent_status.
        // Forcing "running" on every tool_progress oscillates state and
        // restarts avatar gesture loops (page lag / gesture spam).
        return;
      }

      if (type === "message" || type === "message_delta" || type === "message_done") {
        const status = type === "message_delta" ? "streaming" : "done";
        const nextMessage = mergePendingReactions(normalizeMessage(record, status));
        if (type === "message" && asString(record.replaces_stream_id)) {
          const streamId = asString(record.replaces_stream_id)!;
          ttsControlsRef.current?.remapMessageId(streamId, nextMessage.id);
          setMessages((current) => {
            const stream = current.find((m) => m.id === streamId);
            const merged = {
              ...nextMessage,
              toolCalls: stream?.toolCalls,
            };
            return upsertMessage(
              current.filter((m) => m.id !== streamId),
              merged,
            );
          });
        } else {
          setMessages((current) => {
            const existing = current.find((m) => m.id === nextMessage.id);
            return upsertMessage(current, {
              ...nextMessage,
              toolCalls: nextMessage.toolCalls || existing?.toolCalls,
              reactions: nextMessage.reactions?.length
                ? nextMessage.reactions
                : existing?.reactions,
            });
          });
        }
      }

      if (type === "message_delta") {
        setStreaming(true);
      }

      if (type === "message_done") {
        setStreaming(false);
        if (eventSessionId) void loadUsage(eventSessionId);
      }

      if (type === "message" && (record.role === "assistant" || record.author_type === "instance")) {
        setStreaming(false);
        if (eventSessionId) void loadUsage(eventSessionId);
      }
    },
    [loadEvents, loadSessions, loadUsage, selectedSessionId],
  );

  const { connected } = useChatWebSocket(selectedSessionId, handleSocketMessage);

  async function handleCreateSession(input: {
    title: string;
    sessionType: "direct" | "group";
    participantInstanceSlugs?: string[];
    origin?: string;
    slug?: string;
    modelId?: string;
  }) {
    setCreatingSession(true);
    setPageError("");

    try {
      const payload = await api<unknown>("/chat/sessions", {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          session_type: input.sessionType,
          participant_instance_slugs: input.participantInstanceSlugs,
          origin: input.origin,
          slug: input.slug,
          model_id: input.modelId,
        }),
      });

      const nextSession = normalizeSession(payload);
      await loadSessions();
      setSelectedSessionId(nextSession.id);
      navigate(`/chat/${nextSession.id}`);
      setActiveSideTab("viewport");
      if (isMobileChat) {
        setMobileNavOpen(false);
        setMobilePaneOpen(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create session";
      console.error("Failed to create chat session", error);
      setPageError(message);
      throw error;
    } finally {
      setCreatingSession(false);
    }
  }

  async function handleArchiveSession(session: Session) {
    setPageError("");

    try {
      await api(`/chat/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      });
      await loadSessions();
      if (selectedSessionId === session.id) {
        setSelectedSessionId(undefined);
        setMessages([]);
        navigate("/chat");
      }
    } catch (error) {
      console.error(`Failed to archive session ${session.id}`, error);
      setPageError(error instanceof Error ? error.message : "Failed to archive session");
    }
  }

  async function handleResumeSession(session: Session) {
    setPageError("");

    try {
      await api(`/chat/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      });
      await loadSessions();
      setSelectedSessionId(session.id);
      navigate(`/chat/${session.id}`);
    } catch (error) {
      console.error(`Failed to resume session ${session.id}`, error);
      setPageError(error instanceof Error ? error.message : "Failed to resume session");
    }
  }

  function handleSelectSession(session: Session) {
    if (scenePopout.popped) scenePopout.restore();
    setSelectedSessionId(session.id);
    setPageError("");
    navigate(`/chat/${session.id}`);
    if (isMobileChat) setMobileNavOpen(false);
  }

  async function handleModelChange(modelId: string) {
    if (!selectedSessionId || !modelId) return;
    setPageError("");
    try {
      const payload = await api<unknown>(`/chat/sessions/${selectedSessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ model_id: modelId }),
      });
      // keep local lists in sync
      const next = normalizeSession({
        ...(selectedSession || {}),
        ...(isRecord(payload) ? payload : {}),
        modelId,
        model_id: modelId,
      });
      setActiveSessions((current) =>
        current.map((s) => (s.id === next.id ? { ...s, modelId: next.modelId } : s)),
      );
      setArchivedSessions((current) =>
        current.map((s) => (s.id === next.id ? { ...s, modelId: next.modelId } : s)),
      );
    } catch (error) {
      console.error("Failed to update session model", error);
      setPageError(error instanceof Error ? error.message : "Failed to update model");
    }
  }

  async function handlePrimaryChange(slug: string) {
    if (!selectedSessionId || !slug) return;
    setPageError("");
    try {
      await api(`/chat/sessions/${selectedSessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ primary_slug: slug }),
      });
      await loadSessions();
    } catch (error) {
      console.error("Failed to update primary responder", error);
      setPageError(error instanceof Error ? error.message : "Failed to update primary responder");
    }
  }

  async function handleGroupSettingsSave(next: { maxAgentAutoTurns: number }) {
    if (!selectedSessionId) return;
    setPageError("");
    await api(`/chat/sessions/${selectedSessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ max_agent_auto_turns: next.maxAgentAutoTurns }),
    });
    await loadSessions();
  }

  async function handleMaxToolCallsChange(maxToolCalls: number) {
    if (!selectedSessionId) return;
    const next = clampMaxToolCalls(maxToolCalls);
    setPageError("");
    try {
      const payload = await api<unknown>(`/chat/sessions/${selectedSessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ max_tool_calls: next }),
      });
      const updated = normalizeSession({
        ...(selectedSession || {}),
        ...(isRecord(payload) ? payload : {}),
        maxToolCalls: next,
        max_tool_calls: next,
      });
      setActiveSessions((current) =>
        current.map((s) => (s.id === updated.id ? { ...s, maxToolCalls: updated.maxToolCalls } : s)),
      );
      setArchivedSessions((current) =>
        current.map((s) => (s.id === updated.id ? { ...s, maxToolCalls: updated.maxToolCalls } : s)),
      );
    } catch (error) {
      console.error("Failed to update tool-call limit", error);
      setPageError(error instanceof Error ? error.message : "Failed to update tool-call limit");
    }
  }

  async function handleAddParticipant(slug: string) {
    if (!selectedSessionId || !slug) return;
    setPageError("");
    setAddingParticipant(true);
    try {
      await api(`/chat/sessions/${selectedSessionId}/participants`, {
        method: "POST",
        body: JSON.stringify({ slug }),
      });
      await loadSessions();
    } catch (error) {
      console.error("Failed to add participant", error);
      const message = error instanceof Error ? error.message : "Failed to add participant";
      setPageError(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setAddingParticipant(false);
    }
  }

  async function handleRemoveParticipant(slug: string) {
    if (!selectedSessionId || !slug) return;
    setPageError("");
    setRemovingParticipantSlug(slug);
    try {
      await api(`/chat/sessions/${selectedSessionId}/participants/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      await loadSessions();
    } catch (error) {
      console.error("Failed to remove participant", error);
      const message = error instanceof Error ? error.message : "Failed to remove participant";
      setPageError(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setRemovingParticipantSlug(null);
    }
  }

  async function handlePauseParticipant(slug: string, paused: boolean) {
    if (!selectedSessionId || !slug) return;
    setPageError("");
    if (paused) void handleCancelAgent(slug);
    try {
      await api(`/chat/sessions/${selectedSessionId}/participants/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ paused }),
      });
      await loadSessions();
    } catch (error) {
      console.error("Failed to pause participant", error);
      setPageError(error instanceof Error ? error.message : "Failed to pause participant");
    }
  }

  async function handleParticipantModelChange(slug: string, modelId: string) {
    if (!selectedSessionId || !slug || !modelId) return;
    setPageError("");
    try {
      await api(`/chat/sessions/${selectedSessionId}/participants/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ model_id: modelId }),
      });
      await loadSessions();
    } catch (error) {
      console.error("Failed to update participant model", error);
      setPageError(error instanceof Error ? error.message : "Failed to update participant model");
    }
  }

  async function maybeAutoTitleFromMessage(sessionId: string, message: string) {
    const session =
      activeSessions.find((s) => s.id === sessionId) ||
      archivedSessions.find((s) => s.id === sessionId);
    if (!session) return;
    const title = session.title?.trim() || "";
    // Only rewrite empty / placeholder titles
    const isPlaceholder =
      !title ||
      /^chat with /i.test(title) ||
      /^new (dm|group)/i.test(title) ||
      /^group:/i.test(title);
    if (!isPlaceholder) return;

    const snippet = message.replace(/\s+/g, " ").trim().slice(0, 48);
    if (!snippet) return;
    const nextTitle = snippet.length < message.trim().length ? `${snippet}…` : snippet;

    try {
      await api(`/chat/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: nextTitle }),
      });
      setActiveSessions((current) =>
        current.map((s) => (s.id === sessionId ? { ...s, title: nextTitle } : s)),
      );
    } catch (error) {
      console.warn("Failed to auto-title session", error);
    }
  }

  async function deliverOutboxItem(item: OutboxItem, signal?: AbortSignal) {
    updateOutboxItem(item.id, { status: "sending" });
    setOutbox(sessionOutbox(item.sessionId));
    try {
      await maybeAutoTitleFromMessage(item.sessionId, item.text);
      await api(`/chat/sessions/${item.sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: item.text }),
        signal,
      });
      setOutbox(removeOutboxItem(item.id));
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setOutbox(removeOutboxItem(item.id));
        return false;
      }
      console.error(`Failed to send chat message to session ${item.sessionId}`, error);
      setPageError(error instanceof Error ? error.message : "Failed to send message");
      setOutbox(updateOutboxItem(item.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }

  async function pumpOutbox(sessionId: string) {
    if (outboxPumpRef.current) return;
    outboxPumpRef.current = true;
    setSending(true);
    try {
      while (true) {
        const next = sessionOutbox(sessionId).find(
          (item) => item.status === "queued" || item.status === "sending",
        );
        if (!next) break;
        const controller = new AbortController();
        sendAbortRef.current = controller;
        const ok = await deliverOutboxItem(next, controller.signal);
        if (sendAbortRef.current === controller) sendAbortRef.current = null;
        if (!ok) break;
      }
    } finally {
      outboxPumpRef.current = false;
      setSending(false);
    }
  }

  async function handleSend(text: string) {
    if (!selectedSessionId || !text.trim() || stopping) return;

    const outgoing = text.trim();
    setPageError("");

    enqueueOutbox(selectedSessionId, outgoing);
    setOutbox(sessionOutbox(selectedSessionId));
    setStreaming(true);
    void pumpOutbox(selectedSessionId);
  }

  function handleCancelOutbox(id: string) {
    const item = outbox.find((o) => o.id === id);
    if (item?.status === "sending") {
      sendAbortRef.current?.abort();
    }
    setOutbox(removeOutboxItem(id));
  }

  function handleRetryOutbox(id: string) {
    if (!selectedSessionId) return;
    setOutbox(updateOutboxItem(id, { status: "queued", error: undefined }));
    void pumpOutbox(selectedSessionId);
  }

  async function handleStop() {
    if (!selectedSessionId) return;

    setStopping(true);
    sendAbortRef.current?.abort();
    sendAbortRef.current = null;

    // Optimistic clear so Stop all feels reliable even if WS is delayed.
    setMessages((current) =>
      current.map((message) =>
        message.status === "streaming" ? { ...message, status: "done" } : message,
      ),
    );
    setAgentStatus({ state: "cancelled", emoji: "⏹️", label: "cancelled" });
    setAgentStatusesBySlug((current) => {
      const next: Record<string, AgentStatusEvent> = {};
      for (const [slug, status] of Object.entries(current)) {
        next[slug] = { ...status, state: "cancelled", emoji: "⏹️", label: "cancelled" };
      }
      return next;
    });
    setCancellingSlugs({});
    setSending(false);
    setStreaming(false);

    try {
      await api(`/chat/sessions/${selectedSessionId}/stop`, { method: "POST" });
    } catch (error) {
      console.info("Stop endpoint unavailable or failed", error);
      setPageError(error instanceof Error ? error.message : "Failed to stop generation");
    } finally {
      setStopping(false);
    }
  }

  async function handleCancelAgent(slug: string) {
    if (!selectedSessionId || !slug) return;
    setCancellingSlugs((current) => ({ ...current, [slug]: true }));
    setAgentStatusesBySlug((current) => ({
      ...current,
      [slug]: {
        ...(current[slug] || { authorSlug: slug }),
        state: "cancelled",
        emoji: "⏹️",
        label: "cancelled",
        authorSlug: slug,
      },
    }));
    setMessages((current) =>
      current.map((message) =>
        message.status === "streaming" && message.authorSlug === slug
          ? { ...message, status: "done" }
          : message,
      ),
    );
    setAgentStatus((current) =>
      current?.authorSlug === slug
        ? { state: "cancelled", emoji: "⏹️", label: "cancelled", authorSlug: slug }
        : current,
    );
    try {
      await api(`/chat/sessions/${selectedSessionId}/stop/${encodeURIComponent(slug)}`, {
        method: "POST",
      });
    } catch (error) {
      console.info("Per-agent stop failed", error);
      setPageError(error instanceof Error ? error.message : `Failed to cancel @${slug}`);
    } finally {
      setCancellingSlugs((current) => {
        if (!current[slug]) return current;
        const next = { ...current };
        delete next[slug];
        return next;
      });
    }
  }

  function handleOpenEventSession(sessionId: string) {
    if (scenePopout.popped) scenePopout.restore();
    setSelectedSessionId(sessionId);
    navigate(`/chat/${sessionId}`);
    if (isMobileChat) {
      setMobileNavOpen(false);
      setMobilePaneOpen(false);
    }
  }

  function openMobileNav() {
    setMobilePaneOpen(false);
    setMobileNavOpen(true);
  }

  function openMobilePane() {
    setMobileNavOpen(false);
    setMobilePaneOpen(true);
  }

  const avatarViewport = (
    <MultiAvatarViewport
      participantSlugs={selectedSession?.participantInstanceSlugs ?? []}
      sessionType={selectedSession?.sessionType}
      sessionId={selectedSessionId}
      presenceBySlug={presenceBySlug}
      lookAtRequest={sceneLookAt}
      configRequest={avatarConfigRequest}
      ttsSources={ttsSources}
      workspaceSpeakMode={workspaceSpeakMode}
      onWorkspaceSpeakModeChange={handleWorkspaceSpeakModeChange}
      onTtsQueueState={(state) => {
        setTtsQueueState(state);
        if (isScenePopout) scenePopout.postTtsQueueState(state);
      }}
      onTtsControls={handleTtsControls}
      agentStatus={agentStatus}
      toolEvents={viewportToolEvents}
      ttsText={ttsSpeakText}
      ttsMessageId={latestAssistant?.id}
      ttsStreaming={ttsStreaming}
      ttsAuthorSlug={speakingSlug}
      performanceKey={latestDoneAssistant?.id}
      performanceText={latestAssistant?.content ?? latestDoneAssistant?.content}
      voiceId={selectedVoiceId}
      popoutMode={isScenePopout}
      onPopOut={isScenePopout ? undefined : scenePopout.open}
      onReturnToChat={isScenePopout ? scenePopout.dismiss : undefined}
      onPresenceApplied={(slug, patch) => {
        if (patch.fish_voice_id !== undefined) {
          setVoiceBySlug((current) => ({
            ...current,
            [slug]: patch.fish_voice_id || "",
          }));
        }
        if (patch.settings) {
          setPresenceSettingsBySlug((current) => ({
            ...current,
            [slug]: { ...(current[slug] || {}), ...patch.settings },
          }));
        }
      }}
      onTranscript={(transcript) => {
        if (isScenePopout) {
          scenePopout.postTranscript(transcript || "");
          return;
        }
        appendComposerTranscript(transcript);
      }}
      collapsedChat={
        <div className="chat-fs-collapsed">
          {messages.slice(-6).map((m) => (
            <p key={m.id}>
              <strong>{m.authorSlug || m.authorType}:</strong> {m.content.slice(0, 180)}
            </p>
          ))}
        </div>
      }
    />
  );

  if (isScenePopout) {
    if (scenePopout.dismissed) {
      return (
        <div className="chat-scene-popout chat-scene-dismissed">
          <p className="muted">3D view is back in the chat window. You can close this tab.</p>
        </div>
      );
    }
    return (
      <div className="chat-scene-popout">
        {pageError && <p className="badge bad chat-page-error">{pageError}</p>}
        {avatarViewport}
      </div>
    );
  }

  return (
    <div
      className={`chat-workbench ${sidebarCollapsed && !isMobileChat ? "sidebar-collapsed" : ""} ${
        scenePopout.popped ? "scene-popped" : ""
      } ${isMobileChat ? "chat-workbench-mobile" : ""} ${
        isMobileChat && mobileNavOpen ? "mobile-nav-open" : ""
      } ${isMobileChat && mobilePaneOpen ? "mobile-pane-open" : ""}`}
      style={
        {
          "--chat-sidebar-w": isMobileChat ? "0px" : sidebarCollapsed ? "56px" : "320px",
          "--chat-right-w": isMobileChat ? "0px" : scenePopout.popped ? "52px" : `${rightWidth}px`,
        } as CSSProperties
      }
    >
      {isMobileChat && (mobileNavOpen || mobilePaneOpen) ? (
        <button
          type="button"
          className="chat-mobile-backdrop"
          aria-label="Close overlay"
          onClick={() => {
            setMobileNavOpen(false);
            setMobilePaneOpen(false);
          }}
        />
      ) : null}

      <SessionSidebar
        activeSessions={activeSessions}
        archivedSessions={archivedSessions}
        instances={instances}
        selectedSessionId={selectedSessionId}
        showArchived={showArchived}
        hideDefaultAutoRooms={hideDefaultAutoRooms}
        creating={creatingSession}
        collapsed={isMobileChat ? false : sidebarCollapsed}
        drawer={isMobileChat}
        onToggleCollapsed={
          isMobileChat ? () => setMobileNavOpen(false) : () => setSidebarCollapsed((v) => !v)
        }
        sessionPulse={sessionPulse}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onArchiveSession={handleArchiveSession}
        onResumeSession={handleResumeSession}
        onToggleArchived={() => setShowArchived((current) => !current)}
        onToggleHideDefaultAutoRooms={() => setHideDefaultAutoRooms((current) => !current)}
      />

      <div className="chat-main-column">
        {isMobileChat ? (
          <div className="chat-mobile-bar">
            <button
              type="button"
              className="chat-mobile-bar-btn"
              aria-label="Open conversations"
              title="Conversations"
              onClick={openMobileNav}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M4 7h16v2H4V7zm0 4h16v2H4v-2zm0 4h16v2H4v-2z"
                />
              </svg>
            </button>
            <div className="chat-mobile-bar-title">
              <strong>{sessionBarLabel(selectedSession)}</strong>
              {selectedSession ? (
                <span className="muted">
                  {selectedSession.origin} · {selectedSession.sessionType}
                </span>
              ) : (
                <span className="muted">Select a conversation</span>
              )}
            </div>
            <button
              type="button"
              className={`chat-mobile-bar-btn ${mobilePaneOpen ? "on" : ""}`}
              aria-label="Open scene panel"
              title="3D / Events"
              onClick={openMobilePane}
            >
              3D
            </button>
          </div>
        ) : null}
        {pageError && <p className="badge bad chat-page-error">{pageError}</p>}

        <ChatMain
          session={selectedSession}
          messages={messages}
          connected={connected}
          loadingMessages={loadingMessages}
          sending={sending}
          stopping={stopping}
          outbox={outbox}
          agentStatus={agentStatus}
          agentStatusesBySlug={agentStatusesBySlug}
          composerApiRef={composerApiRef}
          onSend={handleSend}
          onStop={() => void handleStop()}
          onCancelAgent={(slug) => void handleCancelAgent(slug)}
          cancellingSlugs={cancellingSlugs}
          onCancelOutbox={handleCancelOutbox}
          onRetryOutbox={handleRetryOutbox}
          onModelChange={(modelId) => void handleModelChange(modelId)}
          onPrimaryChange={(slug) => void handlePrimaryChange(slug)}
          onParticipantDoubleClick={(slug) => {
            if (scenePopout.popped) {
              scenePopout.postLookAt(slug, Date.now());
              return;
            }
            setActiveSideTab("viewport");
            setSceneLookAt({ slug, token: Date.now() });
            if (isMobileChat) openMobilePane();
          }}
          onGroupSettingsSave={handleGroupSettingsSave}
          onMaxToolCallsChange={(n) => void handleMaxToolCallsChange(n)}
          availableAgentSlugs={instances.map((instance) => instance.slug)}
          addingParticipant={addingParticipant}
          removingParticipantSlug={removingParticipantSlug}
          onAddParticipant={(slug) => handleAddParticipant(slug)}
          onRemoveParticipant={(slug) => handleRemoveParticipant(slug)}
          onPauseParticipant={(slug, paused) => void handlePauseParticipant(slug, paused)}
          onParticipantModelChange={(slug, modelId) => void handleParticipantModelChange(slug, modelId)}
          onConfigureAvatar={(slug) => {
            if (scenePopout.popped) {
              scenePopout.postConfig(slug, Date.now());
              return;
            }
            setActiveSideTab("viewport");
            setAvatarConfigRequest({ slug, token: Date.now() });
            if (isMobileChat) openMobilePane();
          }}
          tokenSpend={tokenSpend}
          agentSuggestions={instances.map((instance) => instance.slug)}
          presenceBySlug={presenceBySlug}
          ttsBySlug={ttsBySlug}
          ttsSpeakingSlug={ttsQueueState.speakingSlug}
          ttsQueueLength={ttsQueueState.queueLength}
          onToggleSlugTts={(slug) => {
            setTtsBySlug((current) => ({ ...current, [slug]: current[slug] === false }));
          }}
          onTtsCancelCurrent={() => {
            if (scenePopout.popped) scenePopout.postTtsCancelCurrent();
            else ttsControlsRef.current?.cancelCurrent();
          }}
          onTtsCancelQueue={() => {
            if (scenePopout.popped) scenePopout.postTtsCancelQueue();
            else ttsControlsRef.current?.cancelQueue();
          }}
          compactChrome={isMobileChat}
        />
      </div>

      {scenePopout.popped ? (
        <aside className="chat-scene-restore-rail">
          <button
            type="button"
            className="secondary chat-scene-reset-btn"
            title="Restore 3D view in this window"
            onClick={scenePopout.restore}
          >
            Reset
          </button>
        </aside>
      ) : (
        <>
          <div
            className="chat-col-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize scene panel"
            onPointerDown={(e) => {
              e.preventDefault();
              document.body.classList.add("chat-resizing");
              resizeRef.current = { startX: e.clientX, startW: rightWidth };
            }}
          />

          <aside className="chat-right-column">
            <div className="tabs chat-side-tabs">
              <button
                type="button"
                className={`tab ${activeSideTab === "events" ? "active" : ""}`}
                onClick={() => setActiveSideTab("events")}
              >
                Events
              </button>
              <button
                type="button"
                className={`tab ${activeSideTab === "notes" ? "active" : ""}`}
                onClick={() => setActiveSideTab("notes")}
              >
                Markdown
              </button>
              <button
                type="button"
                className={`tab ${activeSideTab === "viewport" ? "active" : ""}`}
                onClick={() => setActiveSideTab("viewport")}
              >
                3D
              </button>
              {isMobileChat ? (
                <button
                  type="button"
                  className="tab chat-side-close"
                  onClick={() => setMobilePaneOpen(false)}
                >
                  Close
                </button>
              ) : null}
            </div>

            {activeSideTab === "events" ? (
              <EventsPanel
                events={events}
                loading={loadingEvents}
                error={eventsError}
                onRefresh={() => void loadEvents()}
                onOpenSession={handleOpenEventSession}
              />
            ) : activeSideTab === "notes" ? (
              <MarkdownEditor
                title={selectedSession ? "Session notes" : "Workbench notes"}
                value={notesValue}
                saving={notesSaving}
                onChange={setNotesValue}
                onSave={saveNotes}
                onReload={reloadNotes}
              />
            ) : (
              avatarViewport
            )}

            {activeSideTab !== "viewport" && (
              <VoiceDock
                ttsText={ttsSpeakText}
                voiceId={selectedVoiceId}
                onTranscript={appendComposerTranscript}
              />
            )}

            {streaming && (
              <p className="muted chat-streaming-note">
                Streaming response in progress. Use Stop all to interrupt if needed.
              </p>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
