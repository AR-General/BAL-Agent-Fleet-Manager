import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { chatMessages, chatSessionParticipants, chatSessions, instances } from "../db/schema.js";
import {
  duplicateParticipantError,
  lastParticipantRemoveError,
  shouldPromoteToGroup,
} from "./participantRoster.js";
import { aggregateTokenSpend, parseTokenUsage, type SessionTokenSpend } from "./tokenUsage.js";
import { log } from "../utils/logger.js";
import { incMetric } from "../utils/metrics.js";

export class ParticipantActionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ParticipantActionError";
  }
}

type InstanceParticipant = {
  part: typeof chatSessionParticipants.$inferSelect;
  inst: typeof instances.$inferSelect;
};

async function loadInstanceParticipant(
  sessionId: string,
  slug: string,
  tenantId: string,
): Promise<InstanceParticipant> {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, slug), eq(instances.tenantId, tenantId)),
  });
  if (!inst) throw new ParticipantActionError("participant slug not found", 404);
  const part = await db.query.chatSessionParticipants.findFirst({
    where: and(
      eq(chatSessionParticipants.sessionId, sessionId),
      eq(chatSessionParticipants.instanceId, inst.id),
      eq(chatSessionParticipants.participantType, "instance"),
    ),
  });
  if (!part) throw new ParticipantActionError("slug is not a participant of this session", 404);
  return { part, inst };
}

export async function patchSessionParticipant(opts: {
  sessionId: string;
  slug: string;
  tenantId: string;
  paused?: boolean;
  modelId?: string | null;
}): Promise<{ slug: string; paused: boolean; model_id: string | null }> {
  const db = getDb();
  const { part, inst } = await loadInstanceParticipant(opts.sessionId, opts.slug, opts.tenantId);
  const patch: Record<string, unknown> = {};
  if (opts.paused !== undefined) patch.paused = opts.paused;
  if (opts.modelId !== undefined) patch.modelId = opts.modelId;
  if (!Object.keys(patch).length) {
    return { slug: inst.slug, paused: Boolean(part.paused), model_id: part.modelId || null };
  }

  const [row] = await db
    .update(chatSessionParticipants)
    .set(patch)
    .where(eq(chatSessionParticipants.id, part.id))
    .returning();
  await db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, opts.sessionId));

  log.info(
    { sessionId: opts.sessionId, slug: inst.slug, paused: row?.paused, modelId: row?.modelId },
    "session participant patched",
  );
  incMetric("oc_chat_participant_patch_total", "Chat participant pause/model updates");
  return {
    slug: inst.slug,
    paused: Boolean(row?.paused),
    model_id: row?.modelId || null,
  };
}

export async function removeSessionParticipant(opts: {
  sessionId: string;
  slug: string;
  tenantId: string;
}): Promise<{ slug: string; primary_instance_id: string | null }> {
  const db = getDb();
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, opts.sessionId), eq(chatSessions.tenantId, opts.tenantId)),
  });
  if (!session) throw new ParticipantActionError("session not found", 404);

  const { part, inst } = await loadInstanceParticipant(opts.sessionId, opts.slug, opts.tenantId);
  const instanceParts = await db
    .select()
    .from(chatSessionParticipants)
    .where(
      and(
        eq(chatSessionParticipants.sessionId, opts.sessionId),
        eq(chatSessionParticipants.participantType, "instance"),
      ),
    );
  const lastErr = lastParticipantRemoveError(instanceParts.length);
  if (lastErr) throw new ParticipantActionError(lastErr);

  await db.delete(chatSessionParticipants).where(eq(chatSessionParticipants.id, part.id));

  let primaryId = session.primaryInstanceId;
  if (primaryId === inst.id) {
    const remaining = instanceParts.filter((p) => p.id !== part.id);
    primaryId = remaining[0]?.instanceId || null;
    await db
      .update(chatSessions)
      .set({ primaryInstanceId: primaryId, updatedAt: new Date() })
      .where(eq(chatSessions.id, opts.sessionId));
  } else {
    await db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, opts.sessionId));
  }

  log.info({ sessionId: opts.sessionId, slug: inst.slug }, "session participant removed");
  incMetric("oc_chat_participant_remove_total", "Chat participants removed from a session");
  return { slug: inst.slug, primary_instance_id: primaryId };
}

export async function addSessionParticipant(opts: {
  sessionId: string;
  slug: string;
  tenantId: string;
}): Promise<{ slug: string; session_type: string }> {
  const db = getDb();
  const slug = opts.slug.trim();
  if (!slug) throw new ParticipantActionError("slug required");

  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, opts.sessionId), eq(chatSessions.tenantId, opts.tenantId)),
  });
  if (!session) throw new ParticipantActionError("session not found", 404);

  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, slug), eq(instances.tenantId, opts.tenantId)),
  });
  if (!inst) throw new ParticipantActionError("participant slug not found", 404);

  const instanceParts = await db
    .select()
    .from(chatSessionParticipants)
    .where(
      and(
        eq(chatSessionParticipants.sessionId, opts.sessionId),
        eq(chatSessionParticipants.participantType, "instance"),
      ),
    );
  const existingIds = instanceParts
    .map((p) => p.instanceId)
    .filter((id): id is string => Boolean(id));
  const dup = duplicateParticipantError(existingIds, inst.id);
  if (dup) throw new ParticipantActionError(dup, 409);

  await db.insert(chatSessionParticipants).values({
    sessionId: opts.sessionId,
    participantType: "instance",
    instanceId: inst.id,
    displayName: inst.slug,
  });

  const nextCount = existingIds.length + 1;
  const promote = shouldPromoteToGroup(session.sessionType, nextCount);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (promote) patch.sessionType = "group";
  await db.update(chatSessions).set(patch).where(eq(chatSessions.id, opts.sessionId));

  const sessionType = promote ? "group" : session.sessionType;
  log.info(
    { sessionId: opts.sessionId, slug: inst.slug, sessionType, promote },
    "session participant added",
  );
  incMetric("oc_chat_participant_add_total", "Chat participants added to a session");
  return { slug: inst.slug, session_type: sessionType };
}

export async function sessionTokenUsage(opts: {
  sessionId: string;
  tenantId: string;
}): Promise<SessionTokenSpend> {
  const db = getDb();
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, opts.sessionId), eq(chatSessions.tenantId, opts.tenantId)),
  });
  if (!session) throw new ParticipantActionError("session not found", 404);

  const rows = await db
    .select({
      authorInstanceId: chatMessages.authorInstanceId,
      tokenUsage: chatMessages.tokenUsage,
    })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, opts.sessionId));

  const instIds = [...new Set(rows.map((r) => r.authorInstanceId).filter((id): id is string => Boolean(id)))];
  const instRows =
    instIds.length === 0
      ? []
      : await db
          .select({ id: instances.id, slug: instances.slug })
          .from(instances)
          .where(inArray(instances.id, instIds));
  const slugById = new Map(instRows.map((i) => [i.id, i.slug]));

  return aggregateTokenSpend(
    rows.map((row) => ({
      slug: row.authorInstanceId ? slugById.get(row.authorInstanceId) || "unknown" : "unknown",
      usage: parseTokenUsage(row.tokenUsage),
    })),
  );
}
