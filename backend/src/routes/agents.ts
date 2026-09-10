import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { decodeBase64Image } from "../utils/imageData.js";
import { agentImages, agentProfiles, instances } from "../db/schema.js";
import { requireJwt, requireRole } from "../middleware/auth.js";

const router = Router();

const createSchema = z.object({
  instance_slug: z.string(),
  agent_id: z.string(),
  display_name: z.string().optional(),
  role_description: z.string().optional(),
  public_bio: z.string().optional(),
  is_public: z.boolean().optional(),
});

router.post("/", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(
      eq(instances.slug, parsed.data.instance_slug),
      eq(instances.tenantId, req.user!.tenantId),
    ),
  });
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }
  const [row] = await db
    .insert(agentProfiles)
    .values({
      instanceId: inst.id,
      agentId: parsed.data.agent_id,
      displayName: parsed.data.display_name || parsed.data.agent_id,
      roleDescription: parsed.data.role_description,
      publicBio: parsed.data.public_bio,
      isPublic: parsed.data.is_public ?? true,
    })
    .returning();
  res.status(201).json({ ...row, instance_slug: inst.slug });
});

router.get("/", requireJwt, async (req, res) => {
  const db = getDb();
  const insts = await db.select().from(instances).where(eq(instances.tenantId, req.user!.tenantId));
  const agents = [];
  for (const inst of insts) {
    const profiles = await db.select().from(agentProfiles).where(eq(agentProfiles.instanceId, inst.id));
    const runtime = (inst.identity as Record<string, unknown> | undefined)?.runtime ?? "openclaw";
    agents.push(...profiles.map((p) => ({ ...p, instance_slug: inst.slug, runtime })));
  }
  res.json({ agents });
});

router.get("/:id", requireJwt, async (req, res) => {
  const db = getDb();
  const profile = await db.query.agentProfiles.findFirst({
    where: eq(agentProfiles.id, routeParam(req.params.id)),
  });
  if (!profile) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, profile.instanceId),
  });
  if (inst && inst.tenantId !== req.user!.tenantId) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const images = await db.select().from(agentImages).where(eq(agentImages.agentProfileId, profile.id));
  res.json({
    profile: {
      ...profile,
      instance_slug: inst?.slug,
      runtime: (inst?.identity as Record<string, unknown> | undefined)?.runtime ?? "openclaw",
    },
    images: images.map((i) => ({ id: i.id, image_type: i.imageType, mime_type: i.mimeType })),
  });
});

router.delete("/:id", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const profile = await db.query.agentProfiles.findFirst({
    where: eq(agentProfiles.id, routeParam(req.params.id)),
  });
  if (!profile) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, profile.instanceId),
  });
  if (!inst || inst.tenantId !== req.user!.tenantId) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const r = await db.delete(agentProfiles).where(eq(agentProfiles.id, profile.id));
  res.json({ deleted: r.rowCount });
});

router.put("/:id", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const allowed = ["displayName", "roleDescription", "publicBio", "internalNotes", "isPublic"] as const;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  const [row] = await db
    .update(agentProfiles)
    .set(patch)
    .where(eq(agentProfiles.id, routeParam(req.params.id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(row);
});

router.post("/:id/images", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const imageType = (req.body.image_type as string) === "internal" ? "internal" : "public";
  const mime = (req.body.mime_type as string) || "image/png";
  const b64 = req.body.data_base64 as string;
  if (!b64) {
    res.status(400).json({ error: "data_base64 required" });
    return;
  }
  const db = getDb();
  const [row] = await db
    .insert(agentImages)
    .values({
      agentProfileId: routeParam(req.params.id),
      imageType: imageType as "public" | "internal",
      imageData: decodeBase64Image(b64),
      mimeType: mime,
    })
    .returning();
  res.status(201).json({ id: row.id, image_type: row.imageType });
});

router.get("/:id/images/:imageId", requireJwt, async (req, res) => {
  const db = getDb();
  const img = await db.query.agentImages.findFirst({
    where: eq(agentImages.id, routeParam(req.params.imageId)),
  });
  if (!img) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const data = Buffer.isBuffer(img.imageData) ? img.imageData : Buffer.from(img.imageData as Uint8Array);
  res.setHeader("Content-Type", img.mimeType || "application/octet-stream");
  res.setHeader("Content-Length", String(data.length));
  res.end(data);
});

export default router;
