import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { channelConfigs, instances } from "../db/schema.js";
import { requireJwt, requireRole } from "../middleware/auth.js";
import { log } from "../utils/logger.js";
import { syncInstanceChannelsBlob } from "../services/channelSync.js";
import {
  INSTANCE_CHANNEL_META,
  INSTANCE_CHANNEL_TYPES,
} from "../constants/instanceChannels.js";
import { summarizeChannelConfig, summarizePubUrls } from "../services/channelSummary.js";

const router = Router();

const channelTypeSchema = z.enum(INSTANCE_CHANNEL_TYPES);

const channelInputSchema = z.object({
  id: z.string().uuid().optional(),
  channel_type: channelTypeSchema,
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  status: z.string().nullable().optional(),
});

const bulkChannelsSchema = z.object({
  channels: z.array(channelInputSchema),
});

const createChannelSchema = z.object({
  channel_type: channelTypeSchema,
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  status: z.string().nullable().optional(),
});

const updateChannelSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  status: z.string().nullable().optional(),
});

const patchByTypeSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.unknown()).optional(),
  status: z.string().nullable().optional(),
});

async function findInstanceForTenant(slug: string, tenantId: string) {
  const db = getDb();
  return db.query.instances.findFirst({
    where: and(eq(instances.slug, slug), eq(instances.tenantId, tenantId)),
  });
}

function buildMatrixCell(
  channelType: string,
  row: { id: string; enabled: boolean; config: Record<string, unknown>; status: string | null } | undefined,
  instanceUrls: Record<string, string>,
) {
  const config = (row?.config || {}) as Record<string, unknown>;
  const summary =
    channelType === "pub_urls"
      ? summarizePubUrls(config, instanceUrls)
      : summarizeChannelConfig(channelType, config);

  const configured =
    !!row || (channelType === "pub_urls" && Object.keys(instanceUrls).length > 0);

  return {
    id: row?.id ?? null,
    channel_type: channelType,
    configured,
    enabled: row?.enabled ?? false,
    status: row?.status ?? null,
    summary,
    config,
  };
}

router.get("/matrix", requireJwt, async (req, res) => {
  const db = getDb();
  const tenantId = req.user!.tenantId;
  const instRows = await db.query.instances.findMany({
    where: eq(instances.tenantId, tenantId),
    orderBy: (t, { asc }) => [asc(t.slug)],
  });
  if (instRows.length === 0) {
    res.json({
      channel_types: [...INSTANCE_CHANNEL_TYPES],
      channel_meta: INSTANCE_CHANNEL_META,
      instances: [],
    });
    return;
  }

  const instanceIds = instRows.map((i) => i.id);
  const allConfigs = await db
    .select()
    .from(channelConfigs)
    .where(inArray(channelConfigs.instanceId, instanceIds));

  const byInstance = new Map<string, Map<string, (typeof allConfigs)[0]>>();
  for (const row of allConfigs) {
    if (!byInstance.has(row.instanceId)) byInstance.set(row.instanceId, new Map());
    byInstance.get(row.instanceId)!.set(row.channelType, row);
  }

  const matrixInstances = instRows.map((inst) => {
    const identity = (inst.identity || {}) as Record<string, unknown>;
    const displayName =
      (identity.display_name as string) ||
      (identity.public_name as string) ||
      (identity.name as string) ||
      inst.slug;
    const urls = (inst.urls || {}) as Record<string, string>;
    const channelMap = byInstance.get(inst.id) ?? new Map();
    const channels: Record<string, ReturnType<typeof buildMatrixCell>> = {};

    for (const type of INSTANCE_CHANNEL_TYPES) {
      const row = channelMap.get(type);
      channels[type] = buildMatrixCell(
        type,
        row
          ? {
              id: row.id,
              enabled: row.enabled,
              config: (row.config || {}) as Record<string, unknown>,
              status: row.status,
            }
          : undefined,
        urls,
      );
    }

    return {
      id: inst.id,
      slug: inst.slug,
      display_name: displayName,
      host: inst.host,
      status: inst.status,
      health: inst.health,
      urls,
      gateway_url: urls.gateway_intranet || urls.control_ui || null,
      has_gateway_token: !!inst.gatewayTokenEncrypted,
      channels,
    };
  });

  res.json({
    channel_types: [...INSTANCE_CHANNEL_TYPES],
    channel_meta: INSTANCE_CHANNEL_META,
    instances: matrixInstances,
  });
});

router.get("/instance/:slug", requireJwt, async (req, res) => {
  const inst = await findInstanceForTenant(routeParam(req.params.slug), req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const db = getDb();
  const rows = await db.select().from(channelConfigs).where(eq(channelConfigs.instanceId, inst.id));
  const fromInstance = (inst.channels || {}) as Record<string, unknown>;
  res.json({ configured: rows, instance_channels: fromInstance });
});

router.patch(
  "/instance/:slug/by-type/:channelType",
  requireJwt,
  requireRole("admin", "operator"),
  async (req, res) => {
    const parsed = patchByTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const slug = routeParam(req.params.slug);
    const channelType = routeParam(req.params.channelType);
    const typeParsed = channelTypeSchema.safeParse(channelType);
    if (!typeParsed.success) {
      res.status(400).json({ error: "invalid channel_type" });
      return;
    }

    const inst = await findInstanceForTenant(slug, req.user!.tenantId);
    if (!inst) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const db = getDb();
    const existing = await db.query.channelConfigs.findFirst({
      where: and(
        eq(channelConfigs.instanceId, inst.id),
        eq(channelConfigs.channelType, typeParsed.data),
      ),
    });

    let row;
    if (existing) {
      const patch: Record<string, unknown> = { enabled: parsed.data.enabled };
      if (parsed.data.config !== undefined) patch.config = parsed.data.config;
      if (parsed.data.status !== undefined) patch.status = parsed.data.status;
      [row] = await db
        .update(channelConfigs)
        .set(patch)
        .where(eq(channelConfigs.id, existing.id))
        .returning();
    } else if (parsed.data.enabled) {
      [row] = await db
        .insert(channelConfigs)
        .values({
          instanceId: inst.id,
          channelType: typeParsed.data,
          enabled: true,
          config: parsed.data.config ?? {},
          status: parsed.data.status ?? null,
        })
        .returning();
    } else {
      res.status(404).json({ error: "channel not configured" });
      return;
    }

    const instanceChannels = await syncInstanceChannelsBlob(db, inst.id);
    const urls = (inst.urls || {}) as Record<string, string>;
    log.info({ slug, channelType: typeParsed.data, enabled: parsed.data.enabled }, "channel toggled");
    res.json({
      channel: row,
      cell: buildMatrixCell(
        typeParsed.data,
        {
          id: row.id,
          enabled: row.enabled ?? false,
          config: (row.config || {}) as Record<string, unknown>,
          status: row.status,
        },
        urls,
      ),
      instance_channels: instanceChannels,
    });
  },
);

router.put("/instance/:slug", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = bulkChannelsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const slug = routeParam(req.params.slug);
  const inst = await findInstanceForTenant(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const db = getDb();
  const types = new Set<string>();
  for (const ch of parsed.data.channels) {
    if (types.has(ch.channel_type)) {
      res.status(400).json({ error: `duplicate channel_type: ${ch.channel_type}` });
      return;
    }
    types.add(ch.channel_type);
  }

  await db.delete(channelConfigs).where(eq(channelConfigs.instanceId, inst.id));
  const inserted = [];
  for (const ch of parsed.data.channels) {
    const [row] = await db
      .insert(channelConfigs)
      .values({
        instanceId: inst.id,
        channelType: ch.channel_type,
        enabled: ch.enabled ?? false,
        config: ch.config ?? {},
        status: ch.status ?? null,
      })
      .returning();
    inserted.push(row);
  }

  const instanceChannels = await syncInstanceChannelsBlob(db, inst.id);
  log.info({ slug, count: inserted.length }, "channel configs replaced");
  res.json({ configured: inserted, instance_channels: instanceChannels });
});

router.post("/instance/:slug", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const slug = routeParam(req.params.slug);
  const inst = await findInstanceForTenant(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const db = getDb();
  const existing = await db.query.channelConfigs.findFirst({
    where: and(
      eq(channelConfigs.instanceId, inst.id),
      eq(channelConfigs.channelType, parsed.data.channel_type),
    ),
  });
  if (existing) {
    res.status(409).json({ error: `channel ${parsed.data.channel_type} already exists` });
    return;
  }

  const [row] = await db
    .insert(channelConfigs)
    .values({
      instanceId: inst.id,
      channelType: parsed.data.channel_type,
      enabled: parsed.data.enabled ?? false,
      config: parsed.data.config ?? {},
      status: parsed.data.status ?? null,
    })
    .returning();

  const instanceChannels = await syncInstanceChannelsBlob(db, inst.id);
  log.info({ slug, channelType: row.channelType }, "channel config created");
  res.status(201).json({ channel: row, instance_channels: instanceChannels });
});

router.put("/instance/:slug/:channelId", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = updateChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const slug = routeParam(req.params.slug);
  const channelId = routeParam(req.params.channelId);
  const inst = await findInstanceForTenant(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const db = getDb();
  const patch: Record<string, unknown> = {};
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.config !== undefined) patch.config = parsed.data.config;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;

  const [row] = await db
    .update(channelConfigs)
    .set(patch)
    .where(and(eq(channelConfigs.id, channelId), eq(channelConfigs.instanceId, inst.id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "channel not found" });
    return;
  }

  const instanceChannels = await syncInstanceChannelsBlob(db, inst.id);
  log.info({ slug, channelId, channelType: row.channelType }, "channel config updated");
  res.json({ channel: row, instance_channels: instanceChannels });
});

router.delete("/instance/:slug/:channelId", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const slug = routeParam(req.params.slug);
  const channelId = routeParam(req.params.channelId);
  const inst = await findInstanceForTenant(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const db = getDb();
  const [row] = await db
    .delete(channelConfigs)
    .where(and(eq(channelConfigs.id, channelId), eq(channelConfigs.instanceId, inst.id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "channel not found" });
    return;
  }

  const instanceChannels = await syncInstanceChannelsBlob(db, inst.id);
  log.info({ slug, channelId, channelType: row.channelType }, "channel config deleted");
  res.json({ ok: true, instance_channels: instanceChannels });
});

export default router;
