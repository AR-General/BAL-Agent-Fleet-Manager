import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { desc, eq } from "drizzle-orm";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { fleetEvents, healthLog, instances, twilioUsageSnapshots } from "../db/schema.js";
import { requireJwt } from "../middleware/auth.js";

const router = Router();

function parsePrometheus(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?[^}]*\}?\s+([0-9.eE+-]+)/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

router.get("/twilio/metrics", requireJwt, async (_req, res) => {
  try {
    const url = `${config.twilioBridgeInternalUrl.replace(/\/$/, "")}/metrics`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const text = await r.text();
    res.json({ ok: r.ok, metrics: parsePrometheus(text), raw_sample: text.slice(0, 2000) });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/twilio/scrape", requireJwt, async (req, res) => {
  try {
    const url = `${config.twilioBridgeInternalUrl.replace(/\/$/, "")}/metrics`;
    const r = await fetch(url);
    const text = await r.text();
    const metrics = parsePrometheus(text);
    const db = getDb();
    const [snap] = await db
      .insert(twilioUsageSnapshots)
      .values({
        tenantId: req.user!.tenantId,
        period: new Date().toISOString().slice(0, 10),
        data: metrics,
      })
      .returning();
    res.json({ ok: true, snapshot: snap });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/errors", requireJwt, async (req, res) => {
  const db = getDb();
  const insts = await db.select().from(instances).where(eq(instances.tenantId, req.user!.tenantId));
  const errors: Array<Record<string, unknown>> = [];
  for (const inst of insts) {
    const logs = await db
      .select()
      .from(healthLog)
      .where(eq(healthLog.instanceId, inst.id))
      .orderBy(desc(healthLog.ts))
      .limit(20);
    for (const log of logs) {
      if (log.error) {
        errors.push({
          instance_slug: inst.slug,
          source: "health",
          error: log.error,
          ts: log.ts,
        });
      }
    }
    const events = await db
      .select()
      .from(fleetEvents)
      .where(eq(fleetEvents.instanceId, inst.id))
      .orderBy(desc(fleetEvents.createdAt))
      .limit(10);
    for (const ev of events) {
      if (String(ev.eventType).includes("error")) {
        errors.push({
          instance_slug: inst.slug,
          source: "event",
          type: ev.eventType,
          data: ev.data,
          ts: ev.createdAt,
        });
      }
    }
  }
  res.json({ errors: errors.slice(0, 100) });
});

router.get("/usage", requireJwt, async (req, res) => {
  const db = getDb();
  const snaps = await db
    .select()
    .from(twilioUsageSnapshots)
    .where(eq(twilioUsageSnapshots.tenantId, req.user!.tenantId))
    .orderBy(desc(twilioUsageSnapshots.fetchedAt))
    .limit(30);
  res.json({ snapshots: snaps });
});

export default router;
