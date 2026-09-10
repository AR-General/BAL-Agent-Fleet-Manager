import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { agentPresence, instances } from "../db/schema.js";
import { requireJwt } from "../middleware/auth.js";
import { routeParam } from "../utils/params.js";
import {
  avatarPresencePatchFromBody,
  avatarPresenceToClient,
  logAvatarPresenceWrite,
  type AvatarPresenceRow,
} from "../services/avatarPresenceDto.js";

const router = Router();

function clientPresence(slug: string, row: typeof agentPresence.$inferSelect | null | undefined) {
  return avatarPresenceToClient(slug, (row as AvatarPresenceRow | null) || null);
}

router.get("/", requireJwt, async (req, res) => {
  const db = getDb();
  const rows = await db
    .select({
      presence: agentPresence,
      slug: instances.slug,
    })
    .from(agentPresence)
    .innerJoin(instances, eq(agentPresence.instanceId, instances.id))
    .where(eq(instances.tenantId, req.user!.tenantId));
  res.json({
    presence: rows.map((r) => clientPresence(r.slug, r.presence)),
  });
});

router.get("/:slug", requireJwt, async (req, res) => {
  const db = getDb();
  const slug = routeParam(req.params.slug);
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, slug), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const row = await db.query.agentPresence.findFirst({
    where: eq(agentPresence.instanceId, inst.id),
  });
  res.json({ presence: clientPresence(inst.slug, row || null), slug: inst.slug });
});

router.put("/:slug", requireJwt, async (req, res) => {
  const parsed = z
    .object({
      vrm_url: z.string().optional().nullable(),
      gesture_manifest_url: z.string().optional().nullable(),
      default_mood: z.string().optional().nullable(),
      clothes: z.record(z.unknown()).optional(),
      fish_voice_id: z.string().optional().nullable(),
      pointer_look: z.boolean().optional(),
      default_model_id: z.string().optional().nullable(),
      settings: z.record(z.unknown()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const slug = routeParam(req.params.slug);
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, slug), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const existing = await db.query.agentPresence.findFirst({
    where: eq(agentPresence.instanceId, inst.id),
  });
  const patch = avatarPresencePatchFromBody(parsed.data);
  if (existing) {
    const [row] = await db
      .update(agentPresence)
      .set(patch)
      .where(eq(agentPresence.id, existing.id))
      .returning();
    logAvatarPresenceWrite({ slug: inst.slug, created: false, vrmUrl: row?.vrmUrl });
    res.json({ presence: clientPresence(inst.slug, row), slug: inst.slug });
    return;
  }
  const [row] = await db
    .insert(agentPresence)
    .values({ instanceId: inst.id, ...patch })
    .returning();
  logAvatarPresenceWrite({ slug: inst.slug, created: true, vrmUrl: row?.vrmUrl });
  res.status(201).json({ presence: clientPresence(inst.slug, row), slug: inst.slug });
});

export default router;
