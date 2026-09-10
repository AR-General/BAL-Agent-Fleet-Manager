import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/client.js";
import { instanceImages } from "../db/schema.js";

type Db = ReturnType<typeof getDb>;

export async function clearPrimaryForGroup(
  db: Db,
  instanceId: string,
  imageType: "public" | "internal",
  exceptId?: string,
) {
  const rows = await db
    .select({ id: instanceImages.id })
    .from(instanceImages)
    .where(and(eq(instanceImages.instanceId, instanceId), eq(instanceImages.imageType, imageType)));

  for (const row of rows) {
    if (exceptId && row.id === exceptId) continue;
    await db.update(instanceImages).set({ isPrimary: false }).where(eq(instanceImages.id, row.id));
  }
}

export async function setImageAsPrimary(
  db: Db,
  instanceId: string,
  imageId: string,
  imageType: "public" | "internal",
) {
  await clearPrimaryForGroup(db, instanceId, imageType, imageId);
  await db
    .update(instanceImages)
    .set({ isPrimary: true })
    .where(and(eq(instanceImages.id, imageId), eq(instanceImages.instanceId, instanceId)));
}

export async function ensurePrimaryIfNeeded(
  db: Db,
  instanceId: string,
  imageType: "public" | "internal",
  newImageId: string,
  autoRotate: boolean,
) {
  if (autoRotate) return;

  const existing = await db
    .select({ id: instanceImages.id, isPrimary: instanceImages.isPrimary })
    .from(instanceImages)
    .where(and(eq(instanceImages.instanceId, instanceId), eq(instanceImages.imageType, imageType)));

  const hasPrimary = existing.some((r) => r.isPrimary && r.id !== newImageId);
  if (!hasPrimary) {
    await setImageAsPrimary(db, instanceId, newImageId, imageType);
  }
}
