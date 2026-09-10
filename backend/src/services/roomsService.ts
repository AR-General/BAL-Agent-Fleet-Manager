import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  chatMessages,
  chatSessionParticipants,
  chatSessions,
  instances,
} from "../db/schema.js";
import type { AuthInstance, AuthUser } from "../middleware/auth.js";
import { encryptText, decryptText } from "../utils/crypto.js";
import { broadcastChatMessage } from "./chatWs.js";
import { assertRoomAccess, listAccessibleSessionIds } from "./roomAcl.js";
import { maybeInvokeHermesReplies } from "./chatOrchestrator.js";
import { loadReactionsForMessages } from "./messageReactions.js";
import { clampMaxAgentAutoTurns } from "./chatReplyTargets.js";
import { clampMaxToolCalls } from "./chatToolCalls.js";

type Ctx = { user?: AuthUser; instance?: AuthInstance };

function tenantId(ctx: Ctx): string {
  if (ctx.user) return ctx.user.tenantId;
  if (ctx.instance) return ctx.instance.tenantId;
  throw new Error("no auth context");
}

export async function roomList(args: Record<string, unknown>, ctx: Ctx) {
  const db = getDb();
  const tid = tenantId(ctx);
  const origin = args.origin ? String(args.origin) : undefined;
  const status = args.status ? String(args.status) : "active";
  const ids = await listAccessibleSessionIds(ctx);
  let rows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.tenantId, tid))
    .orderBy(desc(chatSessions.updatedAt));
  if (ids !== "all") {
    const set = new Set(ids);
    rows = rows.filter((r) => set.has(r.id));
  }
  if (origin) rows = rows.filter((r) => r.origin === origin);
  if (status) rows = rows.filter((r) => r.status === status);
  if (args.slug) rows = rows.filter((r) => r.slug === String(args.slug));

  const sessionIds = rows.map((r) => r.id);
  const partRows =
    sessionIds.length === 0
      ? []
      : await db
          .select({
            sessionId: chatSessionParticipants.sessionId,
            instanceId: chatSessionParticipants.instanceId,
            displayName: chatSessionParticipants.displayName,
            joinedAt: chatSessionParticipants.joinedAt,
            paused: chatSessionParticipants.paused,
            modelId: chatSessionParticipants.modelId,
          })
          .from(chatSessionParticipants)
          .where(
            and(
              eq(chatSessionParticipants.participantType, "instance"),
              inArray(chatSessionParticipants.sessionId, sessionIds),
            ),
          )
          .orderBy(asc(chatSessionParticipants.joinedAt));

  const partBySession = new Map<string, string[]>();
  const partIdsBySession = new Map<string, string[]>();
  const pausedBySession = new Map<string, string[]>();
  const modelsBySession = new Map<string, Record<string, string>>();
  const instIds = [
    ...new Set(partRows.map((p) => p.instanceId).filter((id): id is string => Boolean(id))),
  ];
  const instRows =
    instIds.length === 0
      ? []
      : await db
          .select({ id: instances.id, slug: instances.slug })
          .from(instances)
          .where(inArray(instances.id, instIds));
  const slugById = new Map(instRows.map((i) => [i.id, i.slug]));
  for (const p of partRows) {
    if (!p.instanceId) continue;
    const slug = slugById.get(p.instanceId) || p.displayName;
    if (!slug) continue;
    const list = partBySession.get(p.sessionId) || [];
    if (!list.includes(slug)) list.push(slug);
    partBySession.set(p.sessionId, list);
    const ids = partIdsBySession.get(p.sessionId) || [];
    if (!ids.includes(p.instanceId)) ids.push(p.instanceId);
    partIdsBySession.set(p.sessionId, ids);
    if (p.paused) {
      const paused = pausedBySession.get(p.sessionId) || [];
      if (!paused.includes(slug)) paused.push(slug);
      pausedBySession.set(p.sessionId, paused);
    }
    if (p.modelId) {
      const models = modelsBySession.get(p.sessionId) || {};
      models[slug] = p.modelId;
      modelsBySession.set(p.sessionId, models);
    }
  }

  return {
    sessions: rows.map((r) => {
      const participantIds = partIdsBySession.get(r.id) || [];
      const primaryId =
        r.primaryInstanceId && participantIds.includes(r.primaryInstanceId)
          ? r.primaryInstanceId
          : participantIds[0] || null;
      return {
        id: r.id,
        title: r.title,
        slug: r.slug,
        origin: r.origin,
        session_type: r.sessionType,
        status: r.status,
        pinned: r.pinned,
        model_id: r.modelId,
        reply_policy: r.replyPolicy,
        primary_instance_id: primaryId,
        primary_slug: primaryId ? slugById.get(primaryId) || null : null,
        max_agent_auto_turns: clampMaxAgentAutoTurns(r.maxAgentAutoTurns),
        max_tool_calls: clampMaxToolCalls(r.maxToolCalls),
        paused_participant_slugs: pausedBySession.get(r.id) || [],
        participant_models: modelsBySession.get(r.id) || {},
        updated_at: r.updatedAt,
        related_event_id: r.relatedEventId,
        participant_instance_slugs: partBySession.get(r.id) || [],
      };
    }),
  };
}

export async function roomCreate(args: Record<string, unknown>, ctx: Ctx) {
  const db = getDb();
  const tid = tenantId(ctx);
  const slug = args.slug ? String(args.slug).toLowerCase() : null;
  const origin = (args.origin as string) || (slug ? "named_channel" : "human");
  const sessionType = (args.session_type as "direct" | "group") || (slug ? "group" : "direct");
  if (slug) {
    const existing = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.tenantId, tid), eq(chatSessions.slug, slug)),
    });
    if (existing) return { session: existing, created: false };
  }
  const [session] = await db
    .insert(chatSessions)
    .values({
      tenantId: tid,
      createdByUserId: ctx.user?.id,
      createdByInstanceId: ctx.instance?.id,
      title: args.title ? String(args.title) : slug,
      slug,
      origin: origin as "human" | "agent_dm" | "named_channel" | "event_mention",
      sessionType,
      modelId: args.model_id ? String(args.model_id) : null,
      replyPolicy: (args.reply_policy as "human_only" | "mentioned_only" | "off") || "human_only",
      relatedEventId: args.related_event_id ? String(args.related_event_id) : null,
    })
    .returning();

  if (ctx.user) {
    await db.insert(chatSessionParticipants).values({
      sessionId: session.id,
      participantType: "user",
      userId: ctx.user.id,
      displayName: ctx.user.email,
    });
  }
  if (ctx.instance) {
    await db.insert(chatSessionParticipants).values({
      sessionId: session.id,
      participantType: "instance",
      instanceId: ctx.instance.id,
      displayName: ctx.instance.slug,
    });
  }

  const slugs = (args.participant_slugs || args.participant_instance_slugs || []) as string[];
  for (const s of slugs) {
    const inst = await db.query.instances.findFirst({
      where: and(eq(instances.slug, s), eq(instances.tenantId, tid)),
    });
    if (!inst) continue;
    if (ctx.instance?.id === inst.id) continue;
    await db.insert(chatSessionParticipants).values({
      sessionId: session.id,
      participantType: "instance",
      instanceId: inst.id,
      displayName: inst.slug,
    });
  }
  return { session, created: true };
}

export async function roomDm(args: Record<string, unknown>, ctx: Ctx) {
  const toSlug = String(args.to_slug || "");
  if (!toSlug) throw new Error("to_slug required");
  const db = getDb();
  const tid = tenantId(ctx);
  const peer = await db.query.instances.findFirst({
    where: and(eq(instances.slug, toSlug), eq(instances.tenantId, tid)),
  });
  if (!peer) throw new Error("peer instance not found");
  if (!ctx.instance) throw new Error("room_dm requires instance auth");
  if (peer.id === ctx.instance.id) throw new Error("cannot DM self");

  // Find existing agent_dm with exactly these two instances
  const myParts = await db
    .select()
    .from(chatSessionParticipants)
    .where(eq(chatSessionParticipants.instanceId, ctx.instance.id));
  for (const p of myParts) {
    const sess = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.id, p.sessionId), eq(chatSessions.origin, "agent_dm")),
    });
    if (!sess) continue;
    const parts = await db
      .select()
      .from(chatSessionParticipants)
      .where(eq(chatSessionParticipants.sessionId, sess.id));
    const ids = parts.filter((x) => x.instanceId).map((x) => x.instanceId!);
    if (ids.length === 2 && ids.includes(peer.id) && ids.includes(ctx.instance.id)) {
      return { session: sess, created: false };
    }
  }

  return roomCreate(
    {
      title: `${ctx.instance.slug} ↔ ${peer.slug}`,
      origin: "agent_dm",
      session_type: "direct",
      participant_slugs: [peer.slug],
      reply_policy: "off",
    },
    ctx,
  );
}

export async function roomPost(args: Record<string, unknown>, ctx: Ctx) {
  const message = String(args.message || args.body || "");
  if (!message) throw new Error("message required");
  const db = getDb();
  let sessionId = args.session_id ? String(args.session_id) : "";
  if (!sessionId && args.slug) {
    const sess = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.tenantId, tenantId(ctx)), eq(chatSessions.slug, String(args.slug))),
    });
    if (!sess) throw new Error("room slug not found");
    sessionId = sess.id;
  }
  if (!sessionId) throw new Error("session_id or slug required");

  await assertRoomAccess(sessionId, ctx);

  let authorType: "user" | "instance" | "contact" | "system" = "system";
  let authorUserId: string | null = null;
  let authorInstanceId: string | null = null;
  if (ctx.instance) {
    authorType = "instance";
    authorInstanceId = ctx.instance.id;
  } else if (ctx.user) {
    authorType = "user";
    authorUserId = ctx.user.id;
  }

  const { encrypted, iv } = encryptText(message);
  const [row] = await db
    .insert(chatMessages)
    .values({
      sessionId,
      role: authorType === "instance" ? "assistant" : "user",
      authorType,
      authorUserId,
      authorInstanceId,
      contentEncrypted: encrypted,
      contentIv: iv,
    })
    .returning();
  await db
    .update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));

  broadcastChatMessage(sessionId, {
    message_id: row.id,
    role: row.role,
    author_type: authorType,
    author_slug: ctx.instance?.slug,
    content: message,
    created_at: row.createdAt,
  });

  // Human-only auto-reply (never on instance posts)
  if (authorType === "user") {
    void maybeInvokeHermesReplies({
      sessionId,
      tenantId: tenantId(ctx),
      userMessage: message,
      authorType,
      user: ctx.user,
      messageId: row.id,
    });
  }

  return { ok: true, message_id: row.id, session_id: sessionId };
}

export async function roomReadHistory(args: Record<string, unknown>, ctx: Ctx) {
  const sessionId = String(args.session_id || "");
  const db = getDb();
  let sid = sessionId;
  if (!sid && args.slug) {
    const sess = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.tenantId, tenantId(ctx)), eq(chatSessions.slug, String(args.slug))),
    });
    if (!sess) throw new Error("room not found");
    sid = sess.id;
  }
  if (!sid) throw new Error("session_id or slug required");
  await assertRoomAccess(sid, ctx);
  const limit = Math.min(Number(args.limit) || 50, 200);
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sid))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  const out = rows.reverse().map((m) => {
    let content = "";
    if (m.contentEncrypted && m.contentIv) {
      try {
        content = decryptText(m.contentEncrypted as Buffer, m.contentIv as Buffer);
      } catch {
        content = "[encrypted]";
      }
    }
    return {
      id: m.id,
      role: m.role,
      author_type: m.authorType,
      author_instance_id: m.authorInstanceId,
      content,
      created_at: m.createdAt,
      tool_name: m.toolName,
      token_usage: m.tokenUsage || undefined,
    };
  });
  const instIds = [
    ...new Set(out.map((m) => m.author_instance_id).filter((id): id is string => Boolean(id))),
  ];
  const instRows =
    instIds.length === 0
      ? []
      : await db
          .select({ id: instances.id, slug: instances.slug })
          .from(instances)
          .where(inArray(instances.id, instIds));
  const slugById = new Map(instRows.map((i) => [i.id, i.slug]));
  const reactionsByMessage = await loadReactionsForMessages(out.map((m) => m.id));
  return {
    messages: out.map((m) => ({
      ...m,
      author_slug: m.author_instance_id ? slugById.get(m.author_instance_id) : undefined,
      reactions: reactionsByMessage.get(m.id) || [],
    })),
    session_id: sid,
  };
}

export async function roomJoin(args: Record<string, unknown>, ctx: Ctx) {
  if (!ctx.user) throw new Error("join requires user auth");
  const db = getDb();
  let sessionId = args.session_id ? String(args.session_id) : "";
  if (!sessionId && args.slug) {
    const sess = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.tenantId, ctx.user.tenantId), eq(chatSessions.slug, String(args.slug))),
    });
    if (!sess) throw new Error("channel not found");
    sessionId = sess.id;
  }
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, sessionId), eq(chatSessions.tenantId, ctx.user.tenantId)),
  });
  if (!session) throw new Error("session not found");
  const existing = await db.query.chatSessionParticipants.findFirst({
    where: and(
      eq(chatSessionParticipants.sessionId, sessionId),
      eq(chatSessionParticipants.userId, ctx.user.id),
    ),
  });
  if (existing) return { ok: true, joined: false, session };
  await db.insert(chatSessionParticipants).values({
    sessionId,
    participantType: "user",
    userId: ctx.user.id,
    displayName: ctx.user.email,
  });
  return { ok: true, joined: true, session };
}
