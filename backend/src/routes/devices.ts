import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { devices } from "../db/schema.js";
import { requireJwt, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/", requireJwt, async (req, res) => {
  const db = getDb();
  const rows = await db.select().from(devices).where(eq(devices.tenantId, req.user!.tenantId));
  res.json({ devices: rows });
});

router.post("/", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = z
    .object({
      name: z.string(),
      device_type: z.enum(["smartphone", "esim_device", "signal_device", "softphone"]),
      serial_or_imei: z.string().optional(),
      notes: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const [row] = await db
    .insert(devices)
    .values({
      tenantId: req.user!.tenantId,
      name: parsed.data.name,
      deviceType: parsed.data.device_type,
      serialOrImei: parsed.data.serial_or_imei,
      notes: parsed.data.notes,
    })
    .returning();
  res.status(201).json(row);
});

router.put("/:id", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const patch: Record<string, unknown> = {};
  if (req.body.name !== undefined) patch.name = req.body.name;
  if (req.body.notes !== undefined) patch.notes = req.body.notes;
  if (req.body.serial_or_imei !== undefined) patch.serialOrImei = req.body.serial_or_imei;
  const [row] = await db
    .update(devices)
    .set(patch)
    .where(and(eq(devices.id, routeParam(req.params.id)), eq(devices.tenantId, req.user!.tenantId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(row);
});

router.delete("/:id", requireJwt, requireRole("admin"), async (req, res) => {
  const db = getDb();
  const r = await db
    .delete(devices)
    .where(and(eq(devices.id, routeParam(req.params.id)), eq(devices.tenantId, req.user!.tenantId)));
  res.json({ deleted: r.rowCount });
});

export default router;
