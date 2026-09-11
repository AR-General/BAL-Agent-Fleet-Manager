import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  agentPresence,
  chatMessages,
  chatSessionParticipants,
  chatSessions,
  instances,
} from "../db/schema.js";
import type { AuthUser } from "../middleware/auth.js";
import { encryptText, decryptText } from "../utils/crypto.js";
import { resolveGatewayToken } from "./gatewayToken.js";
import {
  hermesChatCompletionStream,
  type HermesMessage,
} from "./hermesClient.js";
import {
  buildChannelSystemPrompt,
  resolveChannelIdentity,
} from "./channelIdentity.js";
import {
  CHARACTER_SPEAK_MAX_ROUNDS,
  characterSpeakToolSchema,
} from "./characterSpeakTool.js";
import { processCharacterSpeakRound } from "./characterSpeakRound.js";
import { getTenantSettings } from "./workspaceSettings.js";
import { resolveEffectiveTtsSpeakMode, type TtsSpeakMode } from "./ttsSpeakMode.js";
import {
  broadcastChatMessage,
  broadcastSessionEvent,
} from "./chatWs.js";
import { log } from "../utils/logger.js";
import { parseInstanceTls } from "../utils/instanceTls.js";
import { resolveApiBaseCandidates } from "../utils/instanceEndpoints.js";
import { isViewport3dActive, getViewportOccupants, getViewportEntities } from "./viewportSession.js";
import { mergeRosterIntoOccupants } from "./sceneOccupancy.js";
import {
  applySessionEvent,
  cancelAllSessionLive,
  cancelAuthorSessionLive,
  clearSessionLive,
  getSessionLive,
} from "./sessionLiveState.js";
import { incMetric } from "../utils/metrics.js";
import {
  applyAutoTurnBudget,
  clampMaxAgentAutoTurns,
  parseMentionTokens,
  selectReplyTargetIds,
  toHermesHistoryForAgent,
  type HistoryTurn,
} from "./chatReplyTargets.js";
import { clampMaxToolCalls, hermesStreamTimeoutMs } from "./chatToolCalls.js";
import { upsertMessageReaction } from "./messageReactions.js";
import { presenceFromStoredHealth } from "./agentPresence.js";
import { classifyBotRuntime, shouldRequestStreamUsage, usesOpenAiCompatChat } from "./botRuntime.js";
import { parseTokenUsage } from "./tokenUsage.js";
import { resolveCompletionModel } from "./gatewayClient.js";
import { parseCompletionModelRef } from "./instanceModels.js";
import { parseSlashCommand, runSlashCommand, type ParsedSlashCommand } from "./slashCommands.js";
import { patchSessionParticipant } from "./participantActions.js";

function emitSessionEvent(sessionId: string, payload: Record<string, unknown>): void {
  applySessionEvent(sessionId, payload);
  broadcastSessionEvent(sessionId, payload);
}

type ReplyChain = {
  chainId: string;
  sessionId: string;
  controller: AbortController;
  /** Per-agent abort controllers keyed by instance id (parallel hops). */
  agentControllers: Map<string, AbortController>;
  /** instanceId → slug for cancel-by-slug. */
  inflightSlugs: Map<string, string>;
  cancelled: boolean;
  remainingTurns: number;
  inflight: Set<string>;
  replied: Set<string>;
};

/** Chains keyed by triggering human message id. */
const chainsById = new Map<string, ReplyChain>();
/** sessionId → set of active chain ids */
const chainsBySession = new Map<string, Set<string>>();
const pendingSessionStops = new Set<string>();

function combinedSignal(...signals: AbortSignal[]): AbortSignal {
  const anyFn = (
    AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }
  ).any;
  if (typeof anyFn === "function") return anyFn.call(AbortSignal, signals);
  const merged = new AbortController();
  const onAbort = () => merged.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      merged.abort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return merged.signal;
}

export function stopSessionGeneration(sessionId: string): boolean {
  pendingSessionStops.add(sessionId);
  const chainIds = chainsBySession.get(sessionId);
  if (chainIds) {
    for (const chainId of [...chainIds]) {
      const chain = chainsById.get(chainId);
      if (!chain) continue;
      chain.cancelled = true;
      for (const ac of chain.agentControllers.values()) ac.abort();
      chain.controller.abort();
      chainsById.delete(chainId);
    }
    chainsBySession.delete(sessionId);
  }
  cancelAllSessionLive(sessionId);
  broadcastSessionEvent(sessionId, {
    type: "agent_status",
    state: "cancelled",
    emoji: "⏹️",
    label: "cancelled",
    session_id: sessionId,
  });
  broadcastSessionEvent(sessionId, {
    type: "session_stopped",
    session_id: sessionId,
  });
  incMetric("oc_chat_stop_all_total", "Session stop-all requests");
  return true;
}

/** Abort only one agent's in-flight Hermes call; siblings keep running. */
export function stopAgentGeneration(sessionId: string, slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return false;
  const chainIds = chainsBySession.get(sessionId);
  let displaySlug = slug.trim();
  let aborted = false;

  if (chainIds?.size) {
    for (const chainId of [...chainIds]) {
      const chain = chainsById.get(chainId);
      if (!chain) continue;
      for (const [instanceId, agentSlug] of chain.inflightSlugs) {
        if (agentSlug.toLowerCase() !== normalized) continue;
        displaySlug = agentSlug;
        const ac = chain.agentControllers.get(instanceId);
        if (ac && !ac.signal.aborted) {
          ac.abort();
          aborted = true;
        }
      }
    }
  }

  cancelAuthorSessionLive(sessionId, displaySlug);
  broadcastSessionEvent(sessionId, {
    type: "agent_status",
    author_slug: displaySlug,
    state: "cancelled",
    emoji: "⏹️",
    label: "cancelled",
    session_id: sessionId,
  });
  if (aborted) {
    incMetric("oc_chat_stop_agent_total", "Per-agent stop requests that aborted work");
  }
  log.info({ sessionId, slug: displaySlug, aborted }, "stop agent generation");
  return aborted;
}

function registerChain(chain: ReplyChain): void {
  chainsById.set(chain.chainId, chain);
  const set = chainsBySession.get(chain.sessionId) || new Set<string>();
  set.add(chain.chainId);
  chainsBySession.set(chain.sessionId, set);
}

function unregisterChain(chain: ReplyChain): void {
  chainsById.delete(chain.chainId);
  const set = chainsBySession.get(chain.sessionId);
  if (set) {
    set.delete(chain.chainId);
    if (!set.size) chainsBySession.delete(chain.sessionId);
  }
}

function instanceApiBases(inst: typeof instances.$inferSelect): string[] {
  return resolveApiBaseCandidates({
    urls: (inst.urls || {}) as Record<string, string>,
    identity: (inst.identity || {}) as Record<string, unknown>,
  });
}

function isInstanceOnline(inst: typeof instances.$inferSelect): boolean {
  const health = (inst.health || {}) as Record<string, unknown>;
  return presenceFromStoredHealth(inst.slug, health, inst.lastSeen).online;
}

async function loadHistoryTurns(sessionId: string, limit = 40): Promise<HistoryTurn[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  const instIds = [
    ...new Set(rows.map((m) => m.authorInstanceId).filter((id): id is string => Boolean(id))),
  ];
  const instRows =
    instIds.length === 0
      ? []
      : await db
          .select({ id: instances.id, slug: instances.slug })
          .from(instances)
          .where(inArray(instances.id, instIds));
  const slugById = new Map(instRows.map((i) => [i.id, i.slug]));
  return rows
    .reverse()
    .map((m) => {
      let content = "";
      if (m.contentEncrypted && m.contentIv) {
        try {
          content = decryptText(m.contentEncrypted as Buffer, m.contentIv as Buffer);
        } catch {
          content = "";
        }
      }
      const role =
        m.role === "assistant" || m.role === "system" || m.role === "tool"
          ? m.role
          : "user";
      return {
        role: role as HistoryTurn["role"],
        content,
        authorSlug: m.authorInstanceId ? slugById.get(m.authorInstanceId) || null : null,
      };
    })
    .filter((m) => m.content);
}

type SessionCtx = {
  session: typeof chatSessions.$inferSelect;
  participantIds: string[];
  slugByInstanceId: Map<string, string>;
  participantSlugs: string[];
  primaryInstanceId: string | null;
  primarySlug: string | null;
  maxTurns: number;
  maxToolCalls: number;
  pausedIds: string[];
  modelByInstanceId: Map<string, string | null>;
};

async function loadSessionCtx(sessionId: string): Promise<SessionCtx | null> {
  const db = getDb();
  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, sessionId),
  });
  if (!session) return null;

  const parts = await db
    .select()
    .from(chatSessionParticipants)
    .where(eq(chatSessionParticipants.sessionId, sessionId))
    .orderBy(asc(chatSessionParticipants.joinedAt));
  const instanceParts = parts.filter((p) => p.instanceId && p.participantType === "instance");
  const participantIds = instanceParts.map((p) => p.instanceId!).filter(Boolean);
  const pausedIds = instanceParts.filter((p) => p.paused && p.instanceId).map((p) => p.instanceId!);
  const modelByInstanceId = new Map<string, string | null>();
  for (const p of instanceParts) {
    if (p.instanceId) modelByInstanceId.set(p.instanceId, p.modelId || null);
  }
  const instRows =
    participantIds.length === 0
      ? []
      : await db
          .select({ id: instances.id, slug: instances.slug })
          .from(instances)
          .where(inArray(instances.id, participantIds));
  const slugByInstanceId = new Map(instRows.map((i) => [i.id, i.slug]));
  const participantSlugs = participantIds
    .map((id) => slugByInstanceId.get(id))
    .filter((s): s is string => Boolean(s));

  const primaryInstanceId =
    session.primaryInstanceId && participantIds.includes(session.primaryInstanceId)
      ? session.primaryInstanceId
      : participantIds[0] || null;

  return {
    session,
    participantIds,
    slugByInstanceId,
    participantSlugs,
    primaryInstanceId,
    primarySlug: primaryInstanceId ? slugByInstanceId.get(primaryInstanceId) || null : null,
    maxTurns: clampMaxAgentAutoTurns(session.maxAgentAutoTurns),
    maxToolCalls: clampMaxToolCalls(session.maxToolCalls),
    pausedIds,
    modelByInstanceId,
  };
}

async function stampReaction(opts: {
  sessionId: string;
  messageId: string;
  instanceId: string;
  slug: string;
  kind: "acknowledged" | "ignoring" | "responding";
}): Promise<void> {
  try {
    await upsertMessageReaction(opts);
  } catch (err) {
    log.warn({ err, ...opts }, "failed to stamp message reaction");
  }
}

async function generateOneAgent(opts: {
  chain: ReplyChain;
  ctx: SessionCtx;
  instanceId: string;
  historyTurns: HistoryTurn[];
  identity: ReturnType<typeof resolveChannelIdentity>;
  viewport3dActive: boolean;
  sourceMessageId: string;
}): Promise<{
  content: string;
  slug: string;
  instanceId: string;
  messageId: string;
} | null> {
  const { chain, ctx: hopCtx, instanceId } = opts;
  if (chain.cancelled || chain.controller.signal.aborted) return null;

  const fresh = await loadSessionCtx(chain.sessionId);
  const ctx = fresh || hopCtx;
  if (!ctx.participantIds.includes(instanceId)) {
    log.info({ sessionId: chain.sessionId, instanceId }, "skip Hermes reply: instance left the room");
    return null;
  }

  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
  });
  if (!inst) {
    log.warn({ instanceId }, "skip Hermes reply: instance missing");
    await stampReaction({
      sessionId: chain.sessionId,
      messageId: opts.sourceMessageId,
      instanceId,
      slug: ctx.slugByInstanceId.get(instanceId) || instanceId,
      kind: "ignoring",
    });
    incMetric("oc_chat_reply_skip_total", "Hermes reply skips", 1);
    return null;
  }

  const online = isInstanceOnline(inst);
  const identityMeta = (inst.identity || {}) as Record<string, unknown>;
  const runtime = String(identityMeta.runtime || "openclaw").toLowerCase();
  const apiKey = resolveGatewayToken(inst);
  const bases = instanceApiBases(inst);

  if (!online || !apiKey || !bases.length) {
    log.warn(
      { slug: inst.slug, online, hasKey: Boolean(apiKey), bases: bases.length },
      "skip Hermes reply: offline or missing api key/base URL",
    );
    await stampReaction({
      sessionId: chain.sessionId,
      messageId: opts.sourceMessageId,
      instanceId: inst.id,
      slug: inst.slug,
      kind: "ignoring",
    });
    incMetric("oc_chat_reply_skip_total", "Hermes reply skips", 1);
    return null;
  }

  await stampReaction({
    sessionId: chain.sessionId,
    messageId: opts.sourceMessageId,
    instanceId: inst.id,
    slug: inst.slug,
    kind: "responding",
  });

  chain.inflight.add(inst.id);
  chain.inflightSlugs.set(inst.id, inst.slug);
  const agentController = new AbortController();
  chain.agentControllers.set(inst.id, agentController);
  const signal = combinedSignal(chain.controller.signal, agentController.signal);

  const modelPick =
    ctx.modelByInstanceId.get(instanceId) ||
    ctx.session.modelId ||
    (typeof identityMeta.default_model === "string" ? identityMeta.default_model : undefined);
  const parsedModel = parseCompletionModelRef(modelPick, inst.slug);
  const runtimeKind = classifyBotRuntime(runtime);
  const model =
    runtimeKind === "openclaw"
      ? resolveCompletionModel(parsedModel.isAgentAlias ? inst.slug : undefined, inst.slug)
      : parsedModel.isAgentAlias
        ? undefined
        : parsedModel.model;
  const provider = runtimeKind === "openclaw" ? undefined : parsedModel.provider;

  const streamMsgId = `stream-${inst.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  log.info({ sessionId: chain.sessionId, slug: inst.slug, chainId: chain.chainId, maxToolCalls: ctx.maxToolCalls }, "hermes generation started");
  incMetric("oc_chat_generation_start_total", "Hermes reply generations started");

  emitSessionEvent(chain.sessionId, {
    type: "message_delta",
    message_id: streamMsgId,
    role: "assistant",
    author_type: "instance",
    author_slug: inst.slug,
    content: "",
    delta: "",
  });
  emitSessionEvent(chain.sessionId, {
    type: "agent_status",
    author_slug: inst.slug,
    state: "thinking",
    emoji: "🤔",
    label: "thinking",
    message_id: streamMsgId,
  });

  const presenceRow = await db.query.agentPresence.findFirst({
    where: eq(agentPresence.instanceId, inst.id),
    columns: { settings: true },
  });
  const workspaceSettings = await getTenantSettings(ctx.session.tenantId);
  const ttsSpeakMode: TtsSpeakMode = resolveEffectiveTtsSpeakMode({
    presenceSettings: presenceRow?.settings || {},
    workspaceSettings,
  });

  const systemPrompt = buildChannelSystemPrompt({
    agentSlug: inst.slug,
    identity: opts.identity,
    viewport3dActive: opts.viewport3dActive,
    sessionType: ctx.session.sessionType,
    participantSlugs: ctx.participantSlugs,
    primarySlug: ctx.primarySlug,
    replyPolicy: ctx.session.replyPolicy,
    sceneOccupants: mergeRosterIntoOccupants(
      ctx.participantSlugs,
      getViewportOccupants(chain.sessionId),
    ),
    sceneEntities: getViewportEntities(chain.sessionId),
    ttsSpeakMode,
  });
  const messages: HermesMessage[] = [
    { role: "system", content: systemPrompt },
    ...toHermesHistoryForAgent(opts.historyTurns, inst.slug).filter((m) => m.role !== "system"),
  ];

  let full = "";
  let completionUsage: Record<string, unknown> | undefined;
  let completionModel: string | undefined;
  const seenToolIds = new Set<string>();
  const releaseAgent = () => {
    chain.inflight.delete(inst.id);
    chain.inflightSlugs.delete(inst.id);
    chain.agentControllers.delete(inst.id);
  };

  try {
    if (usesOpenAiCompatChat(runtime)) {
      const useSpeakTool = ttsSpeakMode === "tool";
      let round = 0;
      while (true) {
        round += 1;
        const roundContentBefore = full.length;
        const result = await hermesChatCompletionStream({
          baseUrls: bases,
          apiKey,
          messages,
          model,
          provider,
          signal,
          maxIterations: ctx.maxToolCalls,
          timeoutMs: hermesStreamTimeoutMs(ctx.maxToolCalls),
          includeUsage: shouldRequestStreamUsage(runtime),
          tools: useSpeakTool
            ? [
                characterSpeakToolSchema({
                  selfSlug: inst.slug,
                  peerSlugs: ctx.participantSlugs,
                }),
              ]
            : undefined,
          tls: { allowSelfSigned: parseInstanceTls(inst).allow_self_signed },
          onDelta: (delta) => {
            full += delta;
            emitSessionEvent(chain.sessionId, {
              type: "message_delta",
              message_id: streamMsgId,
              role: "assistant",
              author_type: "instance",
              author_slug: inst.slug,
              delta,
              content: full,
            });
          },
          onReasoningDelta: () => {
            emitSessionEvent(chain.sessionId, {
              type: "agent_status",
              author_slug: inst.slug,
              state: "reasoning",
              emoji: "🧠",
              label: "reasoning",
              message_id: streamMsgId,
            });
          },
          onToolProgress: (progress) => {
            const id = progress.toolCallId || `${progress.tool}-${progress.label}`;
            emitSessionEvent(chain.sessionId, {
              type: "tool_progress",
              message_id: streamMsgId,
              author_slug: inst.slug,
              tool: progress.tool,
              emoji: progress.emoji,
              label: progress.label,
              tool_call_id: progress.toolCallId,
              status: progress.status || "running",
            });
            if (id && !seenToolIds.has(id)) {
              seenToolIds.add(id);
              emitSessionEvent(chain.sessionId, {
                type: "tool_call",
                message_id: streamMsgId,
                author_slug: inst.slug,
                tool: progress.tool,
                emoji: progress.emoji,
                label: progress.label,
                tool_call_id: progress.toolCallId,
                status: progress.status || "running",
              });
            }
          },
          onToolCall: (call) => {
            emitSessionEvent(chain.sessionId, {
              type: "tool_call",
              message_id: streamMsgId,
              author_slug: inst.slug,
              tool: call.name,
              tool_call_id: call.id,
              arguments: call.arguments,
              status: "running",
            });
          },
          onStatus: (status) => {
            emitSessionEvent(chain.sessionId, {
              type: "agent_status",
              author_slug: inst.slug,
              state: status.state,
              emoji: status.emoji,
              label: status.label,
              message_id: streamMsgId,
            });
          },
        });
        // onDelta already appends to `full`. Only fill gaps if the stream
        // returned content without firing deltas (or after a tool-only round).
        const addedViaDelta = full.length - roundContentBefore;
        if (!addedViaDelta && result.content) {
          full += result.content;
          emitSessionEvent(chain.sessionId, {
            type: "message_delta",
            message_id: streamMsgId,
            role: "assistant",
            author_type: "instance",
            author_slug: inst.slug,
            delta: result.content,
            content: full,
          });
        }
        if (result.usage) completionUsage = result.usage;
        if (result.model) completionModel = result.model;

        const roundToolCalls = (result.toolCalls || []).filter(Boolean);
        for (const call of roundToolCalls) {
          if (call.id) seenToolIds.add(call.id);
        }

        if (!useSpeakTool) break;

        const speakRound = processCharacterSpeakRound({
          toolCalls: roundToolCalls,
          roundContent: full.slice(roundContentBefore) || result.content || "",
        });
        for (const ev of speakRound.speakEvents) {
          emitSessionEvent(chain.sessionId, {
            type: "speak",
            message_id: streamMsgId,
            author_slug: inst.slug,
            text: ev.text,
            tool_call_id: ev.tool_call_id,
          });
          incMetric("oc_chat_speak_tool_calls_total", "character_speak tool invocations");
        }
        if (speakRound.parseErrors) {
          log.warn(
            { slug: inst.slug, parseErrors: speakRound.parseErrors },
            "character_speak args parse failed",
          );
          incMetric(
            "oc_chat_speak_tool_parse_errors_total",
            "character_speak argument parse failures",
            speakRound.parseErrors,
          );
        }
        if (!speakRound.shouldContinue) break;

        messages.push(...speakRound.continuationMessages);
        incMetric("oc_chat_speak_tool_rounds_total", "character_speak tool continuation rounds");

        if (round >= CHARACTER_SPEAK_MAX_ROUNDS) {
          log.warn(
            { sessionId: chain.sessionId, slug: inst.slug, rounds: round },
            "character_speak round cap reached; stopping tool loop",
          );
          break;
        }
      }

      incMetric(
        "oc_chat_hermes_tool_calls_total",
        "Hermes tool-call events observed during a generation",
        seenToolIds.size,
      );
      if (!full.trim() && seenToolIds.size) {
        full = `[error: Hermes ended after ${seenToolIds.size} tool calls with no final reply (budget ${ctx.maxToolCalls}).]`;
        log.warn(
          {
            sessionId: chain.sessionId,
            slug: inst.slug,
            toolCalls: seenToolIds.size,
            maxToolCalls: ctx.maxToolCalls,
          },
          "hermes generation ended with tools but no assistant text",
        );
      }
    }
  } catch (e) {
    const userStop =
      chain.cancelled || chain.controller.signal.aborted || agentController.signal.aborted;
    if (e instanceof Error && e.name === "AbortError") {
      if (userStop) {
        emitSessionEvent(chain.sessionId, {
          type: "message_done",
          message_id: streamMsgId,
          author_slug: inst.slug,
          aborted: true,
        });
        emitSessionEvent(chain.sessionId, {
          type: "agent_status",
          author_slug: inst.slug,
          state: "cancelled",
          emoji: "⏹️",
          label: "cancelled",
          message_id: streamMsgId,
        });
        releaseAgent();
        return null;
      }
      log.warn(
        {
          sessionId: chain.sessionId,
          slug: inst.slug,
          toolCalls: seenToolIds.size,
          maxToolCalls: ctx.maxToolCalls,
        },
        "hermes stream timed out",
      );
      if (!full.trim()) {
        full = seenToolIds.size
          ? `[error: timed out after ${seenToolIds.size} tool calls with no final reply. Raise Tool calls under Model (current ${ctx.maxToolCalls}).]`
          : `[error: Hermes stream timed out]`;
      }
    } else {
      log.error({ err: e, slug: inst.slug }, "Hermes reply failed");
      full = full || `[error: ${e instanceof Error ? e.message : String(e)}]`;
    }
  }

  releaseAgent();
  if (chain.cancelled || chain.controller.signal.aborted || agentController.signal.aborted) {
    emitSessionEvent(chain.sessionId, {
      type: "message_done",
      message_id: streamMsgId,
      author_slug: inst.slug,
      aborted: true,
    });
    return null;
  }
  if (!full) {
    emitSessionEvent(chain.sessionId, {
      type: "message_done",
      message_id: streamMsgId,
      author_slug: inst.slug,
      aborted: true,
    });
    return null;
  }

  const usage = parseTokenUsage(completionUsage, completionModel || model);
  const { encrypted, iv } = encryptText(full);
  const [row] = await db
    .insert(chatMessages)
    .values({
      sessionId: chain.sessionId,
      role: "assistant",
      authorType: "instance",
      authorInstanceId: inst.id,
      contentEncrypted: encrypted,
      contentIv: iv,
      tokenUsage: usage || undefined,
    })
    .returning();
  await db
    .update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.id, chain.sessionId));
  broadcastChatMessage(chain.sessionId, {
    message_id: row.id,
    role: "assistant",
    author_type: "instance",
    author_slug: inst.slug,
    content: full,
    created_at: row.createdAt,
    replaces_stream_id: streamMsgId,
    token_usage: usage || undefined,
  });
  emitSessionEvent(chain.sessionId, {
    type: "message_done",
    message_id: row.id,
    stream_id: streamMsgId,
    author_slug: inst.slug,
  });
  emitSessionEvent(chain.sessionId, {
    type: "agent_status",
    author_slug: inst.slug,
    state: "done",
    emoji: "✅",
    label: "done",
    message_id: row.id,
  });
  log.info(
    {
      sessionId: chain.sessionId,
      slug: inst.slug,
      messageId: row.id,
      chainId: chain.chainId,
      model: usage?.model || model,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      costUsd: usage?.cost_usd,
      costEstimated: usage?.estimated,
    },
    "hermes generation finished",
  );
  if (usage) {
    incMetric("oc_chat_prompt_tokens_total", "Prompt tokens used in chat completions", usage.prompt_tokens);
    incMetric(
      "oc_chat_completion_tokens_total",
      "Completion tokens used in chat completions",
      usage.completion_tokens,
    );
    if (usage.cost_usd > 0) {
      incMetric("oc_chat_token_cost_usd_total", "Estimated USD spent on chat completions", usage.cost_usd);
    }
  }
  incMetric("oc_chat_generation_finish_total", "Hermes reply generations finished");
  chain.replied.add(inst.id);
  opts.historyTurns.push({ role: "assistant", content: full, authorSlug: inst.slug });

  return {
    content: full,
    slug: inst.slug,
    instanceId: inst.id,
    messageId: row.id,
  };
}

async function runHop(opts: {
  chain: ReplyChain;
  ctx: SessionCtx;
  targetIds: string[];
  sourceMessageId: string;
  historyTurns: HistoryTurn[];
  identity: ReturnType<typeof resolveChannelIdentity>;
  viewport3dActive: boolean;
  skipBudget?: boolean;
}): Promise<void> {
  const { chain } = opts;
  if (chain.cancelled || (!opts.targetIds.length && !opts.skipBudget)) return;

  let ctx = opts.ctx;
  let targetIds = opts.targetIds;
  if (opts.skipBudget) {
    const fresh = await loadSessionCtx(chain.sessionId);
    if (fresh) {
      ctx = fresh;
      const paused = new Set(fresh.pausedIds);
      targetIds = fresh.participantIds.filter((id) => id && !paused.has(id));
    }
  }
  if (chain.cancelled || !targetIds.length) return;

  const db = getDb();
  const onlineByInstanceId = new Map<string, boolean>();
  for (const id of targetIds) {
    const inst = await db.query.instances.findFirst({ where: eq(instances.id, id) });
    onlineByInstanceId.set(id, inst ? isInstanceOnline(inst) : false);
  }

  const budgeted = applyAutoTurnBudget({
    targetIds,
    remainingTurns: chain.remainingTurns,
    onlineByInstanceId,
    skipBudget: opts.skipBudget,
  });

  for (const id of budgeted.ignore) {
    const slug = ctx.slugByInstanceId.get(id) || id;
    await stampReaction({
      sessionId: chain.sessionId,
      messageId: opts.sourceMessageId,
      instanceId: id,
      slug,
      kind: "ignoring",
    });
  }
  if (budgeted.ignore.length) {
    incMetric(
      "oc_chat_auto_turn_budget_exhausted_total",
      "Agent auto-turn budget exhausted (ignored targets)",
      budgeted.ignore.length,
    );
    log.info(
      {
        sessionId: chain.sessionId,
        chainId: chain.chainId,
        ignored: budgeted.ignore.map((id) => ctx.slugByInstanceId.get(id)),
        remaining: chain.remainingTurns,
      },
      "auto-turn budget truncated hop",
    );
  }

  const generate = budgeted.generate.filter((id) => !chain.inflight.has(id));
  if (!generate.length) return;

  for (const id of generate) {
    const slug = ctx.slugByInstanceId.get(id) || id;
    await stampReaction({
      sessionId: chain.sessionId,
      messageId: opts.sourceMessageId,
      instanceId: id,
      slug,
      kind: "acknowledged",
    });
  }

  chain.remainingTurns -= generate.length;
  incMetric("oc_chat_reply_targets", "Hermes reply target agents per hop", generate.length);

  const results = await Promise.all(
    generate.map((instanceId) =>
      generateOneAgent({
        chain,
        ctx,
        instanceId,
        historyTurns: opts.historyTurns,
        identity: opts.identity,
        viewport3dActive: opts.viewport3dActive,
        sourceMessageId: opts.sourceMessageId,
      }),
    ),
  );

  // Serialize follow-up hops so budget accounting stays correct.
  for (const result of results) {
    if (!result || chain.cancelled || chain.remainingTurns <= 0) continue;
    await enqueueFollowUpHop({
      chain,
      ctx,
      sourceMessageId: result.messageId,
      sourceContent: result.content,
      sourceInstanceId: result.instanceId,
      historyTurns: opts.historyTurns,
      identity: opts.identity,
      viewport3dActive: opts.viewport3dActive,
    });
  }
}

async function enqueueFollowUpHop(opts: {
  chain: ReplyChain;
  ctx: SessionCtx;
  sourceMessageId: string;
  sourceContent: string;
  sourceInstanceId: string;
  historyTurns: HistoryTurn[];
  identity: ReturnType<typeof resolveChannelIdentity>;
  viewport3dActive: boolean;
}): Promise<void> {
  const { chain, ctx } = opts;
  if (chain.cancelled || chain.remainingTurns <= 0) return;

  const parsed = parseMentionTokens(opts.sourceContent);
  const targets = selectReplyTargetIds({
    replyPolicy: "mentioned_only",
    participantInstanceIds: ctx.participantIds,
    mentionSlugs: parsed.slugs,
    broadcast: parsed.broadcast,
    slugByInstanceId: ctx.slugByInstanceId,
    primaryInstanceId: ctx.primaryInstanceId,
    pausedInstanceIds: ctx.pausedIds,
  }).filter((id) => id !== opts.sourceInstanceId && !chain.inflight.has(id));

  if (!targets.length) return;

  log.info(
    {
      sessionId: chain.sessionId,
      chainId: chain.chainId,
      from: ctx.slugByInstanceId.get(opts.sourceInstanceId),
      targets: targets.map((id) => ctx.slugByInstanceId.get(id)),
      remaining: chain.remainingTurns,
    },
    "hermes follow-up hop from agent mention",
  );

  await runHop({
    chain,
    ctx,
    targetIds: targets,
    sourceMessageId: opts.sourceMessageId,
    historyTurns: opts.historyTurns,
    identity: opts.identity,
    viewport3dActive: opts.viewport3dActive,
  });
}

async function publishCommandReply(opts: {
  sessionId: string;
  inst: typeof instances.$inferSelect;
  text: string;
}): Promise<void> {
  const db = getDb();
  const { encrypted, iv } = encryptText(opts.text);
  const [row] = await db
    .insert(chatMessages)
    .values({
      sessionId: opts.sessionId,
      role: "assistant",
      authorType: "instance",
      authorInstanceId: opts.inst.id,
      contentEncrypted: encrypted,
      contentIv: iv,
    })
    .returning();
  await db
    .update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.id, opts.sessionId));
  broadcastChatMessage(opts.sessionId, {
    message_id: row.id,
    role: "assistant",
    author_type: "instance",
    author_slug: opts.inst.slug,
    content: opts.text,
    created_at: row.createdAt,
  });
  emitSessionEvent(opts.sessionId, {
    type: "agent_status",
    author_slug: opts.inst.slug,
    state: "done",
    emoji: "✅",
    label: "done",
    message_id: row.id,
  });
}

async function dispatchSlashCommand(opts: {
  sessionId: string;
  tenantId: string;
  ctx: SessionCtx;
  cmd: ParsedSlashCommand;
}): Promise<void> {
  const wanted = selectReplyTargetIds({
    replyPolicy: opts.cmd.mentionSlugs.length ? "mentioned_only" : "human_only",
    participantInstanceIds: opts.ctx.participantIds,
    mentionSlugs: opts.cmd.mentionSlugs,
    broadcast: false,
    slugByInstanceId: opts.ctx.slugByInstanceId,
    primaryInstanceId: opts.ctx.primaryInstanceId,
    pausedInstanceIds: opts.ctx.pausedIds,
  });
  const targetId = wanted[0] || opts.ctx.primaryInstanceId;
  if (!targetId) {
    log.warn({ sessionId: opts.sessionId, command: opts.cmd.name }, "slash command: no target agent");
    return;
  }
  const db = getDb();
  const inst = await db.query.instances.findFirst({ where: eq(instances.id, targetId) });
  if (!inst) return;

  const currentModelId = opts.ctx.modelByInstanceId.get(targetId) || opts.ctx.session.modelId || null;
  const result = await runSlashCommand({ cmd: opts.cmd, inst, currentModelId });
  if (result.nextModelId) {
    await patchSessionParticipant({
      sessionId: opts.sessionId,
      slug: inst.slug,
      tenantId: opts.tenantId,
      modelId: result.nextModelId,
    });
    if (targetId === opts.ctx.primaryInstanceId) {
      await db
        .update(chatSessions)
        .set({ modelId: result.nextModelId, updatedAt: new Date() })
        .where(eq(chatSessions.id, opts.sessionId));
    }
    emitSessionEvent(opts.sessionId, {
      type: "session_model",
      model_id: result.nextModelId,
      slug: inst.slug,
    });
  }
  await publishCommandReply({ sessionId: opts.sessionId, inst, text: result.text });
}

/** After a human user message is persisted, stream Hermes replies for target instances. */
export async function maybeInvokeHermesReplies(opts: {
  sessionId: string;
  tenantId: string;
  userMessage: string;
  authorType: string;
  user?: AuthUser | null;
  /** Triggering human message id — used as chain id. */
  messageId: string;
}): Promise<void> {
  if (opts.authorType !== "user") return;
  if (!opts.messageId) {
    log.warn({ sessionId: opts.sessionId }, "maybeInvokeHermesReplies missing messageId");
    return;
  }

  const ctx = await loadSessionCtx(opts.sessionId);
  if (!ctx) return;
  if (!ctx.participantIds.length) return;

  const cmd = parseSlashCommand(opts.userMessage);
  if (cmd) {
    log.info(
      { sessionId: opts.sessionId, command: cmd.name, args: cmd.args.slice(0, 80) },
      "dispatching slash command (not LLM chat)",
    );
    await dispatchSlashCommand({
      sessionId: opts.sessionId,
      tenantId: opts.tenantId,
      ctx,
      cmd,
    });
    return;
  }

  if (ctx.session.replyPolicy === "off") return;

  const parsed = parseMentionTokens(opts.userMessage);
  const wantedIds = selectReplyTargetIds({
    replyPolicy: ctx.session.replyPolicy,
    participantInstanceIds: ctx.participantIds,
    mentionSlugs: parsed.slugs,
    broadcast: parsed.broadcast,
    slugByInstanceId: ctx.slugByInstanceId,
    primaryInstanceId: ctx.primaryInstanceId,
  });
  const paused = new Set(ctx.pausedIds);
  for (const id of wantedIds) {
    if (!paused.has(id)) continue;
    await stampReaction({
      sessionId: opts.sessionId,
      messageId: opts.messageId,
      instanceId: id,
      slug: ctx.slugByInstanceId.get(id) || id,
      kind: "ignoring",
    });
  }
  const targetIds = wantedIds.filter((id) => !paused.has(id));
  if (!targetIds.length) {
    log.info(
      { sessionId: opts.sessionId, replyPolicy: ctx.session.replyPolicy, mentions: parsed },
      "hermes reply: no targets",
    );
    return;
  }

  const historyTurns = await loadHistoryTurns(opts.sessionId);
  const identity = resolveChannelIdentity(opts.user);
  const viewport3dActive = isViewport3dActive(opts.sessionId);

  const chain: ReplyChain = {
    chainId: opts.messageId,
    sessionId: opts.sessionId,
    controller: new AbortController(),
    agentControllers: new Map(),
    inflightSlugs: new Map(),
    cancelled: false,
    remainingTurns: ctx.maxTurns,
    inflight: new Set(),
    replied: new Set(),
  };

  // A new human message supersedes prior in-flight chains for this session.
  const prior = chainsBySession.get(opts.sessionId);
  if (prior) {
    for (const priorId of [...prior]) {
      const existing = chainsById.get(priorId);
      if (!existing) continue;
      existing.cancelled = true;
      for (const ac of existing.agentControllers.values()) ac.abort();
      existing.controller.abort();
      chainsById.delete(priorId);
    }
    chainsBySession.delete(opts.sessionId);
  }

  registerChain(chain);

  if (pendingSessionStops.has(opts.sessionId)) {
    pendingSessionStops.delete(opts.sessionId);
    chain.cancelled = true;
    chain.controller.abort();
  }

  log.info(
    {
      sessionId: opts.sessionId,
      chainId: chain.chainId,
      sessionType: ctx.session.sessionType,
      primary: ctx.primarySlug,
      targets: targetIds.map((id) => ctx.slugByInstanceId.get(id)),
      broadcast: parsed.broadcast,
      maxTurns: ctx.maxTurns,
    },
    "hermes group reply chain started",
  );

  try {
    await runHop({
      chain,
      ctx,
      targetIds,
      sourceMessageId: opts.messageId,
      historyTurns,
      identity,
      viewport3dActive,
      skipBudget: parsed.broadcast,
    });
  } finally {
    unregisterChain(chain);
    if (!chainsBySession.has(opts.sessionId)) {
      pendingSessionStops.delete(opts.sessionId);
    }
    if (getSessionLive(opts.sessionId).generating && !chainsBySession.has(opts.sessionId)) {
      log.warn({ sessionId: opts.sessionId }, "clearing leftover generating snapshot");
      applySessionEvent(opts.sessionId, {
        type: "agent_status",
        state: "cancelled",
        emoji: "⏹️",
        label: "interrupted",
      });
      clearSessionLive(opts.sessionId);
    }
  }
}
