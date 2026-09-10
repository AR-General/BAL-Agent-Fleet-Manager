import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { instanceImages, instances } from "../db/schema.js";
import { requireJwt, requireRole } from "../middleware/auth.js";
import { log } from "../utils/logger.js";
import { decodeBase64Image } from "../utils/imageData.js";
import {
  ensurePrimaryIfNeeded,
  setImageAsPrimary,
} from "../services/instanceImagePrimary.js";

const router = Router({ mergeParams: true });

export type ProfileImageGroupSettings = {
  auto_rotate: boolean;
  rotate_interval_sec: number | null;
};

export type ProfileImageSettings = {
  public: ProfileImageGroupSettings;
  internal: ProfileImageGroupSettings;
};

const DEFAULT_GROUP: ProfileImageGroupSettings = {
  auto_rotate: false,
  rotate_interval_sec: null,
};

export const DEFAULT_PROFILE_IMAGE_SETTINGS: ProfileImageSettings = {
  public: { ...DEFAULT_GROUP },
  internal: { ...DEFAULT_GROUP },
};

export function readProfileImageSettings(identity: Record<string, unknown> | null | undefined): ProfileImageSettings {
  const raw = (identity?.profile_images || {}) as Record<string, unknown>;
  const readGroup = (key: "public" | "internal"): ProfileImageGroupSettings => {
    const g = (raw[key] || {}) as Record<string, unknown>;
    return {
      auto_rotate: Boolean(g.auto_rotate),
      rotate_interval_sec:
        typeof g.rotate_interval_sec === "number" && g.rotate_interval_sec > 0
          ? Math.floor(g.rotate_interval_sec)
          : null,
    };
  };
  return { public: readGroup("public"), internal: readGroup("internal") };
}

const settingsSchema = z.object({
  public: z
    .object({
      auto_rotate: z.boolean(),
      rotate_interval_sec: z.number().int().positive().nullable().optional(),
    })
    .optional(),
  internal: z
    .object({
      auto_rotate: z.boolean(),
      rotate_interval_sec: z.number().int().positive().nullable().optional(),
    })
    .optional(),
});

const uploadSchema = z.object({
  image_type: z.enum(["public", "internal"]),
  mime_type: z.string().min(1).optional(),
  data_base64: z.string().min(1),
  label: z.string().nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  sort_order: z.number().int().optional(),
  is_primary: z.boolean().optional(),
});

const patchImageSchema = z.object({
  label: z.string().nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  sort_order: z.number().int().optional(),
  is_primary: z.boolean().optional(),
});

const imageMetaSelect = {
  id: instanceImages.id,
  imageType: instanceImages.imageType,
  mimeType: instanceImages.mimeType,
  label: instanceImages.label,
  probability: instanceImages.probability,
  sortOrder: instanceImages.sortOrder,
  isPrimary: instanceImages.isPrimary,
  uploadedAt: instanceImages.uploadedAt,
};

async function findInstance(slug: string, tenantId: string) {
  const db = getDb();
  return db.query.instances.findFirst({
    where: and(eq(instances.slug, slug), eq(instances.tenantId, tenantId)),
  });
}

router.get("/", requireJwt, async (req, res) => {
  const slug = routeParam(req.params.slug);
  const inst = await findInstance(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }
  const db = getDb();
  const images = await db
    .select(imageMetaSelect)
    .from(instanceImages)
    .where(eq(instanceImages.instanceId, inst.id))
    .orderBy(asc(instanceImages.sortOrder), asc(instanceImages.uploadedAt));

  res.json({
    settings: readProfileImageSettings(inst.identity as Record<string, unknown>),
    images,
  });
});

router.put("/settings", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const slug = routeParam(req.params.slug);
  const inst = await findInstance(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }

  const current = readProfileImageSettings(inst.identity as Record<string, unknown>);
  const next: ProfileImageSettings = {
    public: parsed.data.public
      ? {
          auto_rotate: parsed.data.public.auto_rotate,
          rotate_interval_sec: parsed.data.public.rotate_interval_sec ?? null,
        }
      : current.public,
    internal: parsed.data.internal
      ? {
          auto_rotate: parsed.data.internal.auto_rotate,
          rotate_interval_sec: parsed.data.internal.rotate_interval_sec ?? null,
        }
      : current.internal,
  };

  const identity = { ...(inst.identity || {}), profile_images: next };
  const db = getDb();
  const [row] = await db
    .update(instances)
    .set({ identity })
    .where(eq(instances.id, inst.id))
    .returning({ identity: instances.identity });

  log.info({ slug }, "instance profile image settings updated");
  res.json({ settings: readProfileImageSettings(row.identity as Record<string, unknown>) });
});

router.post("/", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const slug = routeParam(req.params.slug);
  const inst = await findInstance(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }

  const settings = readProfileImageSettings(inst.identity as Record<string, unknown>);
  const imageType = parsed.data.image_type;
  const groupSettings = settings[imageType];

  const db = getDb();
  const [row] = await db
    .insert(instanceImages)
    .values({
      instanceId: inst.id,
      imageType,
      imageData: decodeBase64Image(parsed.data.data_base64),
      mimeType: parsed.data.mime_type || "image/png",
      label: parsed.data.label ?? null,
      probability: parsed.data.probability ?? null,
      sortOrder: parsed.data.sort_order ?? 0,
      isPrimary: parsed.data.is_primary ?? false,
    })
    .returning(imageMetaSelect);

  if (parsed.data.is_primary) {
    await setImageAsPrimary(db, inst.id, row.id, imageType);
  } else {
    await ensurePrimaryIfNeeded(db, inst.id, imageType, row.id, groupSettings.auto_rotate);
  }

  const [finalRow] = await db
    .select(imageMetaSelect)
    .from(instanceImages)
    .where(eq(instanceImages.id, row.id));

  log.info({ slug, imageId: row.id, imageType: row.imageType }, "instance profile image uploaded");
  res.status(201).json({ image: finalRow ?? row });
});

router.put("/:imageId", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = patchImageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const slug = routeParam(req.params.slug);
  const imageId = routeParam(req.params.imageId);
  const inst = await findInstance(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.probability !== undefined) patch.probability = parsed.data.probability;
  if (parsed.data.sort_order !== undefined) patch.sortOrder = parsed.data.sort_order;
  if (parsed.data.is_primary !== undefined) patch.isPrimary = parsed.data.is_primary;

  const db = getDb();
  const [row] = await db
    .update(instanceImages)
    .set(patch)
    .where(and(eq(instanceImages.id, imageId), eq(instanceImages.instanceId, inst.id)))
    .returning(imageMetaSelect);
  if (!row) {
    res.status(404).json({ error: "image not found" });
    return;
  }

  if (parsed.data.is_primary === true) {
    await setImageAsPrimary(db, inst.id, row.id, row.imageType as "public" | "internal");
  }

  const [finalRow] = await db
    .select(imageMetaSelect)
    .from(instanceImages)
    .where(eq(instanceImages.id, row.id));

  res.json({ image: finalRow ?? row });
});

router.delete("/:imageId", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const slug = routeParam(req.params.slug);
  const imageId = routeParam(req.params.imageId);
  const inst = await findInstance(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }

  const db = getDb();
  const existing = await db.query.instanceImages.findFirst({
    where: and(eq(instanceImages.id, imageId), eq(instanceImages.instanceId, inst.id)),
  });
  if (!existing) {
    res.status(404).json({ error: "image not found" });
    return;
  }

  await db
    .delete(instanceImages)
    .where(and(eq(instanceImages.id, imageId), eq(instanceImages.instanceId, inst.id)));

  const settings = readProfileImageSettings(inst.identity as Record<string, unknown>);
  const imageType = existing.imageType as "public" | "internal";
  const groupSettings = settings[imageType];

  if (existing.isPrimary && !groupSettings.auto_rotate) {
    const remaining = await db
      .select({ id: instanceImages.id })
      .from(instanceImages)
      .where(and(eq(instanceImages.instanceId, inst.id), eq(instanceImages.imageType, imageType)))
      .orderBy(asc(instanceImages.sortOrder), asc(instanceImages.uploadedAt))
      .limit(1);
    if (remaining[0]) {
      await setImageAsPrimary(db, inst.id, remaining[0].id, imageType);
    }
  }

  log.info({ slug, imageId }, "instance profile image deleted");
  res.json({ ok: true });
});

router.get("/:imageId", requireJwt, async (req, res) => {
  const slug = routeParam(req.params.slug);
  const imageId = routeParam(req.params.imageId);
  const inst = await findInstance(slug, req.user!.tenantId);
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }

  const db = getDb();
  const img = await db.query.instanceImages.findFirst({
    where: and(eq(instanceImages.id, imageId), eq(instanceImages.instanceId, inst.id)),
  });
  if (!img) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const data = Buffer.isBuffer(img.imageData) ? img.imageData : Buffer.from(img.imageData as Uint8Array);
  if (data.length === 0) {
    res.status(404).json({ error: "image data empty" });
    return;
  }
  res.setHeader("Content-Type", img.mimeType || "application/octet-stream");
  res.setHeader("Content-Length", String(data.length));
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.end(data);
});

export default router;
