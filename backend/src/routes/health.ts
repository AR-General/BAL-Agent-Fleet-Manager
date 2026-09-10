import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { healthLog, instances } from "../db/schema.js";
import { requireJwt } from "../middleware/auth.js";
import { pingAllInstances, pingInstanceRecord, presenceForSlugs } from "../services/healthPinger.js";
import { fetchHealthz } from "../utils/httpFetch.js";
import { httpWarningForUrl, resolveHealthUrlCandidates } from "../utils/instanceEndpoints.js";
import { parseInstanceTls, tlsSelfSignedWarning } from "../utils/instanceTls.js";
import { instanceToPublic, instancesToPublic } from "../utils/instancePublic.js";
import { log } from "../utils/logger.js";

const router = Router();

const tlsSchema = z.object({
  gateway_https: z.boolean().optional(),
  allow_self_signed: z.boolean().optional(),
});

router.get("/", requireJwt, async (req, res) => {
  const db = getDb();
  const list = await db.select().from(instances).where(eq(instances.tenantId, req.user!.tenantId));
  res.json({ fleet: instancesToPublic(list), ts: new Date().toISOString() });
});

router.post("/probe", requireJwt, async (req, res) => {
  const parsed = z
    .object({
      url: z.string(),
      allow_self_signed: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const allowSelfSigned = parsed.data.allow_self_signed ?? false;
  const result = await fetchHealthz(parsed.data.url, { allowSelfSigned });
  const tls_warning =
    allowSelfSigned && parsed.data.url.startsWith("https://")
      ? result.tls_warning ?? tlsSelfSignedWarning({ gateway_https: true, allow_self_signed: true })
      : result.tls_warning;
  res.json({ ...result, tls_warning, tls_hint: result.tls_hint });
});

router.get("/:slug", requireJwt, async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const tls = parseInstanceTls(inst);
  const urls = (inst.urls || {}) as Record<string, string>;
  const identity = (inst.identity || {}) as Record<string, unknown>;
  const candidates = resolveHealthUrlCandidates(urls, identity);
  let live = null;
  let usedFallback = false;
  for (let i = 0; i < candidates.length; i++) {
    const probe = await fetchHealthz(candidates[i].url, {
      allowSelfSigned: tls.allow_self_signed,
      healthPath: candidates[i].path,
    });
    live = probe;
    if (probe.ok) {
      usedFallback = candidates[i].role === "fallback";
      break;
    }
  }
  const tls_warning = live?.ok
    ? tlsSelfSignedWarning(tls) ?? live.tls_warning
    : live?.tls_hint
      ? live.tls_hint
      : live?.tls_warning;
  const http_warning = live?.ok ? httpWarningForUrl(live.url) : undefined;
  res.json({
    instance: instanceToPublic(inst),
    tls,
    tls_warning,
    http_warning,
    used_fallback: usedFallback,
    live_check: live ? { ...live, tls_warning, http_warning, used_fallback: usedFallback } : null,
  });
});

router.post("/ping-all", requireJwt, async (_req, res) => {
  await pingAllInstances();
  res.json({ ok: true });
});

router.post("/presence", requireJwt, async (req, res) => {
  const parsed = z
    .object({
      slugs: z.array(z.string().min(1)).max(24),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const participants = await presenceForSlugs(parsed.data.slugs, req.user!.tenantId);
    res.json({ participants, ts: new Date().toISOString() });
  } catch (e) {
    log.error({ err: e }, "presence probe request failed");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/:slug/ping", requireJwt, async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const result = await pingInstanceRecord(inst);
  const updated = await db.query.instances.findFirst({ where: eq(instances.id, inst.id) });
  const tls = parseInstanceTls(updated ?? inst);
  res.json({
    ping: result,
    tls,
    tls_warning: result.tls_warning ?? tlsSelfSignedWarning(tls),
    instance: updated ? instanceToPublic(updated) : null,
  });
});

router.get("/:slug/history", requireJwt, async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const logs = await db
    .select()
    .from(healthLog)
    .where(eq(healthLog.instanceId, inst.id))
    .orderBy(desc(healthLog.ts))
    .limit(100);
  res.json({ logs, tls_warning: tlsSelfSignedWarning(parseInstanceTls(inst)) });
});

export default router;
