import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { fleetEvents, instanceImages, instances } from "../db/schema.js";
import { requireInstanceAuth, requireJwt, requireRole } from "../middleware/auth.js";
import { config } from "../config.js";
import { buildAllowedOrigins } from "../utils/allowedOrigins.js";
import { normalizeTls } from "../utils/instanceTls.js";
import { defaultUrls, portsFromGatewayPort, portsFromSlot, type InstancePorts } from "../utils/ports.js";
import { attachFallbackUrls } from "../utils/instanceEndpoints.js";
import { executeTool } from "../services/toolExecutor.js";
import { encryptGatewayToken } from "../services/gatewayToken.js";
import { instanceToPublic, instancesToPublic } from "../utils/instancePublic.js";
import { readProfileImageSettings } from "./instance-images.js";
import { pickProfileImageForGroup } from "../utils/profileImagePick.js";
import { listInstanceLlmModels } from "../services/instanceModels.js";


const router = Router();
const portsSchema = z.object({
  slot: z.number().int().min(0).max(9).optional(),
  gateway: z.number().int().positive().optional(),
  bridge: z.number().int().positive().optional(),
  https: z.number().int().positive().optional(),
  bridge_https: z.number().int().positive().optional(),
  signal: z.number().int().positive().optional(),
  twilio: z.number().int().positive().optional(),
  ollama: z.number().int().positive().optional(),
});

const tlsSchema = z.object({
  gateway_https: z.boolean().optional(),
  allow_self_signed: z.boolean().optional(),
});

const registerSchema = z.object({
  slug: z.string(),
  identity: z.record(z.unknown()).optional(),
  ports: portsSchema.optional(),
  port_slot: z.number().min(0).max(9).optional(),
  port: z.number().int().optional(),
  host: z.string().optional(),
  urls: z.record(z.string()).optional(),
  channels: z.record(z.unknown()).optional(),
  tls: tlsSchema.optional(),
  gateway_token: z.string().optional(),
});

router.get("/", requireJwt, async (req, res) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(instances)
    .where(eq(instances.tenantId, req.user!.tenantId));
  res.json({ instances: instancesToPublic(rows) });
});

/** Primary profile image per instance for list previews (public or internal-first). */
router.get("/profile-previews", requireJwt, async (req, res) => {
  const visibility = String(req.query.visibility || "public");
  const preferInternal = visibility === "internal";
  const db = getDb();
  const tenantId = req.user!.tenantId;

  const instRows = await db
    .select({ id: instances.id, slug: instances.slug, identity: instances.identity })
    .from(instances)
    .where(eq(instances.tenantId, tenantId));

  if (instRows.length === 0) {
    res.json({ previews: {} });
    return;
  }

  const instanceIds = instRows.map((i) => i.id);
  const images = await db
    .select({
      instanceId: instanceImages.instanceId,
      id: instanceImages.id,
      imageType: instanceImages.imageType,
      sortOrder: instanceImages.sortOrder,
      isPrimary: instanceImages.isPrimary,
    })
    .from(instanceImages)
    .where(inArray(instanceImages.instanceId, instanceIds))
    .orderBy(asc(instanceImages.sortOrder), asc(instanceImages.uploadedAt));

  const byInstance = new Map<string, typeof images>();
  for (const img of images) {
    if (!byInstance.has(img.instanceId)) byInstance.set(img.instanceId, []);
    byInstance.get(img.instanceId)!.push(img);
  }

  const previews: Record<
    string,
    { image_id: string; image_type: string; is_primary: boolean } | null
  > = {};

  for (const inst of instRows) {
    const group = byInstance.get(inst.id) ?? [];
    const settings = readProfileImageSettings(inst.identity as Record<string, unknown>);
    const types = preferInternal ? (["internal", "public"] as const) : (["public"] as const);
    let chosen: ReturnType<typeof pickProfileImageForGroup> | undefined;
    for (const t of types) {
      chosen = pickProfileImageForGroup(group, t, settings[t]);
      if (chosen) break;
    }
    previews[inst.slug] = chosen
      ? { image_id: chosen.id, image_type: chosen.imageType, is_primary: !!chosen.isPrimary }
      : null;
  }

  res.json({ previews, visibility: preferInternal ? "internal" : "public" });
});

router.get("/port-presets/:slot", requireJwt, (req, res) => {
  const slot = Number(routeParam(req.params.slot));
  if (Number.isNaN(slot) || slot < 0 || slot > 9) {
    res.status(400).json({ error: "slot must be 0-9" });
    return;
  }
  const ports = portsFromSlot(slot);
  const host = String(req.query.host || config.defaultHost);
  res.json({
    ports,
    urls: defaultUrls(host, ports),
    allowed_origins: buildAllowedOrigins({ host, ports }),
    bases: config.portBases,
  });
});

router.post("/compute-urls", requireJwt, (req, res) => {
  const parsed = z
    .object({
      host: z.string().min(1),
      ports: portsSchema,
      tls: tlsSchema.optional(),
      fallback_host: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const p = parsed.data.ports as InstancePorts;
  const tls = normalizeTls(parsed.data.tls);
  const host = parsed.data.host;
  const urls = attachFallbackUrls(
    defaultUrls(host, p, { gatewayHttps: tls.gateway_https }),
    parsed.data.fallback_host,
  );
  res.json({
    urls,
    allowed_origins: buildAllowedOrigins({ host, ports: p }),
  });
});

router.post("/derive-ports", requireJwt, (req, res) => {
  const parsed = z
    .object({
      gateway: z.number().int().min(1).max(65535),
      slot_fallback: z.number().int().min(0).max(9).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const ports = portsFromGatewayPort(parsed.data.gateway, parsed.data.slot_fallback ?? 0);
  res.json({ ports, bases: config.portBases });
});

router.get("/fleet/summary", requireJwt, async (req, res) => {
  const data = await executeTool("fleet_status", {}, { user: req.user });
  res.json(data);
});

router.post("/register", requireInstanceAuth, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const result = await executeTool(
    "fleet_register",
    { ...parsed.data, slug: parsed.data.slug || req.authInstance?.slug },
    { instance: req.authInstance },
  );
  res.json(result);
});

router.post("/", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await executeTool("fleet_register", parsed.data, { user: req.user });
    res.status(201).json(result);
  } catch (err) {
    const status = (err as { status?: number }).status;
    res.status(typeof status === "number" && status >= 400 ? status : 400).json({
      error: err instanceof Error ? err.message : "register failed",
    });
  }
});

router.get("/:slug/events", requireJwt, async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const events = await db
    .select()
    .from(fleetEvents)
    .where(eq(fleetEvents.instanceId, inst.id))
    .orderBy(desc(fleetEvents.createdAt))
    .limit(limit);
  res.json({ events });
});

  /** List LLM models from the gateway `/api/model/options` (not the OpenAI-compat agent alias). */
router.get("/:slug/models", requireJwt, async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const result = await listInstanceLlmModels(inst);
  const missing = result.error === "api_base missing" || result.error === "api_key_missing";
  res.status(missing ? 503 : 200).json({
    ...result,
    hint:
      result.error === "api_key_missing"
        ? "Set API_SERVER_KEY / gateway token on this instance."
        : result.error && !result.models.length
          ? result.error
          : undefined,
  });
});

router.get("/:slug", requireJwt, async (req, res) => {
  const db = getDb();
  const row = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(instanceToPublic(row));
});

router.put("/:slug", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const allowed = ["identity", "ports", "host", "urls", "channels", "tls", "status", "primaryTeamId"] as const;
  const patch: Record<string, unknown> = { lastSeen: new Date() };
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  if (req.body.gateway_token !== undefined) {
    const tok = String(req.body.gateway_token || "").trim();
    patch.gatewayTokenEncrypted = tok ? encryptGatewayToken(tok) : null;
  }
  const [row] = await db
    .update(instances)
    .set(patch)
    .where(and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(instanceToPublic(row));
});

router.delete("/:slug", requireJwt, requireRole("admin"), async (req, res) => {
  const db = getDb();
  const r = await db
    .delete(instances)
    .where(and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)));
  res.json({ deleted: r.rowCount });
});

export default router;
