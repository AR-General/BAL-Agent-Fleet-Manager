import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { fleetEvents, instances } from "../db/schema.js";
import { requireInstanceAuth, requireJwt, requireJwtOrInstance } from "../middleware/auth.js";
import { executeTool } from "../services/toolExecutor.js";
import { decryptText } from "../utils/crypto.js";

const router = Router();

function decodeEvent(ev: typeof fleetEvents.$inferSelect, slug?: string) {
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
      /* keep legacy data */
    }
  }
  return {
    id: ev.id,
    instance_id: ev.instanceId,
    instance_slug: slug,
    event_type: ev.eventType,
    tags: ev.tags || [],
    summary,
    data,
    mention_instance_ids: ev.mentionInstanceIds || [],
    related_session_id: ev.relatedSessionId,
    created_at: ev.createdAt,
  };
}

router.post("/push", requireInstanceAuth, async (req, res) => {
  const parsed = z
    .object({
      instance_slug: z.string().optional(),
      type: z.string(),
      tags: z.array(z.string()).optional(),
      summary: z.string().optional(),
      data: z.record(z.unknown()).optional(),
      mention_slugs: z.array(z.string()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const result = await executeTool("fleet_push_event", parsed.data, {
    instance: req.authInstance,
  });
  res.json(result);
});

/** Tenant-wide feed for portal + agents. */
router.get("/feed", requireJwtOrInstance, async (req, res) => {
  const db = getDb();
  const tid = req.user?.tenantId || req.authInstance?.tenantId;
  if (!tid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db
    .select()
    .from(fleetEvents)
    .where(or(eq(fleetEvents.tenantId, tid), isNull(fleetEvents.tenantId)))
    .orderBy(desc(fleetEvents.createdAt))
    .limit(limit);
  const instMap = new Map(
    (
      await db.select({ id: instances.id, slug: instances.slug }).from(instances).where(eq(instances.tenantId, tid))
    ).map((i) => [i.id, i.slug]),
  );
  // Filter to tenant instances when tenant_id null (legacy)
  const events = rows
    .filter((e) => e.tenantId === tid || instMap.has(e.instanceId))
    .map((e) => decodeEvent(e, instMap.get(e.instanceId)));
  res.json({ events });
});

router.get("/tags", requireJwt, async (_req, res) => {
  res.json({
    tags: [
      "heartbeat",
      "started_conversation",
      "pr_opened",
      "pr_merged",
      "deploy",
      "incident",
      "handoff",
      "custom",
    ],
  });
});

router.get("/:slug/feed", requireInstanceAuth, async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: eq(instances.slug, routeParam(req.params.slug)),
  });
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const feed = await db
    .select()
    .from(fleetEvents)
    .where(eq(fleetEvents.instanceId, inst.id))
    .orderBy(desc(fleetEvents.createdAt))
    .limit(limit);
  res.json({ events: feed.map((e) => decodeEvent(e, inst.slug)) });
});

export default router;
