export type Session = {
  id: string;
  title: string | null;
  slug?: string | null;
  status: "active" | "archived" | string;
  origin: "human" | "agent_dm" | "named_channel" | "event_mention" | string;
  sessionType: "direct" | "group" | string;
  modelId: string | null;
  pinned: boolean;
  participantInstanceSlugs: string[];
  replyPolicy?: "human_only" | "mentioned_only" | "off" | string;
  primaryInstanceId?: string | null;
  primarySlug?: string | null;
  maxAgentAutoTurns?: number;
  maxToolCalls?: number;
  pausedParticipantSlugs?: string[];
  participantModels?: Record<string, string>;
  updatedAt: string | null;
  createdAt: string | null;
};

export type ToolCallVisual = {
  id: string;
  tool?: string;
  emoji?: string;
  label?: string;
  status?: string;
  arguments?: string;
};

export type MessageReactionKind = "acknowledged" | "ignoring" | "responding";

export type MessageReaction = {
  messageId: string;
  instanceId: string;
  slug: string;
  kind: MessageReactionKind;
  updatedAt?: string;
};

export type ChatMessage = {
  id: string;
  sessionId?: string;
  role: "user" | "assistant" | "system" | "tool" | string;
  authorType: "user" | "instance" | "contact" | "system" | string;
  authorSlug?: string;
  content: string;
  createdAt: string;
  status?: "streaming" | "done" | "queued" | "sending" | "failed";
  toolCalls?: ToolCallVisual[];
  outboxId?: string;
  reactions?: MessageReaction[];
};

export type AgentStatusEvent = {
  state: string;
  emoji?: string;
  label?: string;
  authorSlug?: string;
};

export type FleetEvent = {
  id: string;
  eventType: string;
  summary?: string | null;
  tags?: string[];
  data: Record<string, unknown>;
  relatedSessionId?: string | null;
  createdAt: string;
};
