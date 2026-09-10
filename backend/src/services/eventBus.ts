import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  chatSessionParticipants,
  chatSessions,
  fleetEvents,
  instances,
} from "../db/schema.js";
import type { AuthInstance } from "../middleware/auth.js";
import { encryptText, decryptText } from "../utils/crypto.js";
import { roomPost } from "./roomsService.js";
import { broadcastTenantEvent } from "./chatWs.js";

/** Mentioned agent replies to an event → idempotent auto room. */
export async function eventReply(opts: {
  eventId: string;
  instance: AuthInstance;
  message: string;
}): Promise<unknown> {
  const db = getDb();
  const ev = await db.query.fleetEvents.findFirst({
    where: eq(fleetEvents.id, opts.eventId),
  });
  if (!ev) throw new Error("event not found");
  if (ev.tenantId && ev.tenantId !== opts.instance.tenantId) {
    throw new Error("event not found");
  }
  const mentions = ev.mentionInstanceIds || [];
  if (!mentions.includes(opts.instance.id)) {
    throw new Error("not mentioned on this event");
  }

  // Idempotent: one room per (event, replier)
  const existing = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.tenantId, opts.instance.tenantId),
        eq(chatSessions.origin, "event_mention"),
        eq(chatSessions.relatedEventId, opts.eventId),
      ),
    );
  let session = existing.find(async () => false);
  for (const s of existing) {
    const parts = await db
      .select()
      .from(chatSessionParticipants)
      .where(eq(chatSessionParticipants.sessionId, s.id));
    if (parts.some((p) => p.instanceId === opts.instance.id)) {
      session = s;
      break;
    }
  }

  if (!session) {
    const emitter = await db.query.instances.findFirst({
      where: eq(instances.id, ev.instanceId),
    });
    let summary = "";
    if (ev.summaryEncrypted && ev.summaryIv) {
      try {
        summary = decryptText(ev.summaryEncrypted as Buffer, ev.summaryIv as Buffer);
      } catch {
        summary = ev.eventType;
      }
    }
    const [created] = await db
      .insert(chatSessions)
      .values({
        tenantId: opts.instance.tenantId,
        createdByInstanceId: opts.instance.id,
        title: summary || `Event ${ev.eventType}`,
        origin: "event_mention",
        sessionType: "direct",
        replyPolicy: "off",
        relatedEventId: ev.id,
      })
      .returning();
    session = created;
    const participantIds = [ev.instanceId, opts.instance.id];
    for (const id of [...new Set(participantIds)]) {
      const inst = await db.query.instances.findFirst({ where: eq(instances.id, id) });
      if (!inst) continue;
      await db.insert(chatSessionParticipants).values({
        sessionId: session.id,
        participantType: "instance",
        instanceId: inst.id,
        displayName: inst.slug,
      });
    }
    await db
      .update(fleetEvents)
      .set({ relatedSessionId: session.id })
      .where(eq(fleetEvents.id, ev.id));
    broadcastTenantEvent(opts.instance.tenantId, {
      type: "fleet_event",
      event: {
        id: ev.id,
        related_session_id: session.id,
        auto_room: true,
      },
    });
  }

  return roomPost(
    { session_id: session.id, message: opts.message },
    { instance: opts.instance },
  );
}

export async function listTenantEvents(opts: {
  tenantId: string;
  limit?: number;
}): Promise<unknown[]> {
  const db = getDb();
  const limit = Math.min(opts.limit || 50, 200);
  const rows = await db
    .select()
    .from(fleetEvents)
    .where(eq(fleetEvents.tenantId, opts.tenantId))
    .orderBy(desc(fleetEvents.createdAt))
    .limit(limit);

  const out = [];
  for (const ev of rows) {
    let summary = "";
    let data: Record<string, unknown> = (ev.data as Record<string, unknown>) || {};
    if (ev.summaryEncrypted && ev.summaryIv) {
      try {
        summary = decryptText(ev.summaryEncrypted as Buffer, ev.summaryIv as Buffer);
      } catch {
        summary = "";
      }
    }
    if (ev.dataEncrypted && ev.dataIv) {
      try {
        data = JSON.parse(decryptText(ev.dataEncrypted as Buffer, ev.dataIv as Buffer));
      } catch {
        /* keep legacy */
      }
    }
    const inst = await db.query.instances.findFirst({ where: eq(instances.id, ev.instanceId) });
    out.push({
      id: ev.id,
      instance_id: ev.instanceId,
      instance_slug: inst?.slug,
      event_type: ev.eventType,
      tags: ev.tags || [],
      summary,
      data,
      mention_instance_ids: ev.mentionInstanceIds || [],
      related_session_id: ev.relatedSessionId,
      created_at: ev.createdAt,
    });
  }
  return out;
}

// silence unused encrypt import if only decrypt used — keep for future
void encryptText;
