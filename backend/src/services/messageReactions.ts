import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { chatMessageReactions, instances } from "../db/schema.js";
import { broadcastSessionEvent } from "./chatWs.js";
import { log } from "../utils/logger.js";
import { incMetric } from "../utils/metrics.js";

export type ReactionKind = "acknowledged" | "ignoring" | "responding";

export type MessageReactionRow = {
  message_id: string;
  instance_id: string;
  slug: string;
  kind: ReactionKind;
  updated_at: string;
};

/** Upsert a reaction on a message for one instance and fan out over WS. */
export async function upsertMessageReaction(opts: {
  sessionId: string;
  messageId: string;
  instanceId: string;
  slug: string;
  kind: ReactionKind;
}): Promise<MessageReactionRow> {
  const db = getDb();
  const now = new Date();
  const existing = await db.query.chatMessageReactions.findFirst({
    where: and(
      eq(chatMessageReactions.messageId, opts.messageId),
      eq(chatMessageReactions.instanceId, opts.instanceId),
    ),
  });

  let row;
  if (existing) {
    [row] = await db
      .update(chatMessageReactions)
      .set({ kind: opts.kind, updatedAt: now })
      .where(eq(chatMessageReactions.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(chatMessageReactions)
      .values({
        messageId: opts.messageId,
        instanceId: opts.instanceId,
        kind: opts.kind,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  }

  const payload = {
    type: "message_reaction",
    session_id: opts.sessionId,
    message_id: opts.messageId,
    instance_id: opts.instanceId,
    slug: opts.slug,
    kind: opts.kind,
    updated_at: row.updatedAt.toISOString(),
  };
  broadcastSessionEvent(opts.sessionId, payload);
  incMetric("oc_chat_message_reaction_total", "Chat message reactions stamped", 1);
  log.info(
    { sessionId: opts.sessionId, messageId: opts.messageId, slug: opts.slug, kind: opts.kind },
    "message reaction",
  );
  return {
    message_id: opts.messageId,
    instance_id: opts.instanceId,
    slug: opts.slug,
    kind: opts.kind,
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function loadReactionsForMessages(
  messageIds: string[],
): Promise<Map<string, MessageReactionRow[]>> {
  const out = new Map<string, MessageReactionRow[]>();
  if (!messageIds.length) return out;
  const db = getDb();
  const rows = await db
    .select({
      messageId: chatMessageReactions.messageId,
      instanceId: chatMessageReactions.instanceId,
      kind: chatMessageReactions.kind,
      updatedAt: chatMessageReactions.updatedAt,
    })
    .from(chatMessageReactions)
    .where(inArray(chatMessageReactions.messageId, messageIds));

  const instIds = [...new Set(rows.map((r) => r.instanceId))];
  const instRows =
    instIds.length === 0
      ? []
      : await db
          .select({ id: instances.id, slug: instances.slug })
          .from(instances)
          .where(inArray(instances.id, instIds));
  const slugById = new Map(instRows.map((i) => [i.id, i.slug]));

  for (const r of rows) {
    const slug = slugById.get(r.instanceId) || r.instanceId;
    const list = out.get(r.messageId) || [];
    list.push({
      message_id: r.messageId,
      instance_id: r.instanceId,
      slug,
      kind: r.kind as ReactionKind,
      updated_at: r.updatedAt.toISOString(),
    });
    out.set(r.messageId, list);
  }
  return out;
}
