import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { instances, phoneNumbers } from "../db/schema.js";
import { requireJwt, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/", requireJwt, async (req, res) => {
  const db = getDb();
  const rows = await db.select().from(phoneNumbers).where(eq(phoneNumbers.tenantId, req.user!.tenantId));
  res.json({ phone_numbers: rows });
});

const schema = z.object({
  number: z.string(),
  label: z.string().optional(),
  number_type: z.enum(["virtual_twilio", "esim", "physical_sim"]),
  inbound_enabled: z.boolean().optional(),
  outbound_enabled: z.boolean().optional(),
  voice_enabled: z.boolean().optional(),
  sms_enabled: z.boolean().optional(),
  whatsapp_enabled: z.boolean().optional(),
  assigned_instance_slug: z.string().optional().nullable(),
});

async function resolveInstanceId(tenantId: string, slug: string | null | undefined) {
  if (!slug) return null;
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, slug), eq(instances.tenantId, tenantId)),
  });
  return inst?.id ?? null;
}

router.post("/", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const assignedInstanceId =
    parsed.data.assigned_instance_slug !== undefined
      ? await resolveInstanceId(req.user!.tenantId, parsed.data.assigned_instance_slug)
      : undefined;

  const [row] = await db
    .insert(phoneNumbers)
    .values({
      tenantId: req.user!.tenantId,
      number: parsed.data.number,
      label: parsed.data.label,
      numberType: parsed.data.number_type,
      inboundEnabled: parsed.data.inbound_enabled,
      outboundEnabled: parsed.data.outbound_enabled,
      voiceEnabled: parsed.data.voice_enabled,
      smsEnabled: parsed.data.sms_enabled,
      whatsappEnabled: parsed.data.whatsapp_enabled,
      ...(assignedInstanceId !== undefined ? { assignedInstanceId } : {}),
    })
    .returning();
  res.status(201).json(row);
});

router.put("/:id", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const patch: Record<string, unknown> = {};
  const map: Record<string, string> = {
    label: "label",
    inbound_enabled: "inboundEnabled",
    outbound_enabled: "outboundEnabled",
    voice_enabled: "voiceEnabled",
    sms_enabled: "smsEnabled",
    whatsapp_enabled: "whatsappEnabled",
  };
  for (const [snake, camel] of Object.entries(map)) {
    if (req.body[snake] !== undefined) patch[camel] = req.body[snake];
    if (req.body[camel] !== undefined) patch[camel] = req.body[camel];
  }

  if (req.body.assigned_instance_slug !== undefined) {
    const slug = req.body.assigned_instance_slug as string | null;
    if (!slug) {
      patch.assignedInstanceId = null;
    } else {
      const instanceId = await resolveInstanceId(req.user!.tenantId, slug);
      if (!instanceId) {
        res.status(400).json({ error: `instance not found: ${slug}` });
        return;
      }
      patch.assignedInstanceId = instanceId;
    }
  }

  const [row] = await db
    .update(phoneNumbers)
    .set(patch)
    .where(
      and(eq(phoneNumbers.id, routeParam(req.params.id)), eq(phoneNumbers.tenantId, req.user!.tenantId)),
    )
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
    .delete(phoneNumbers)
    .where(
      and(eq(phoneNumbers.id, routeParam(req.params.id)), eq(phoneNumbers.tenantId, req.user!.tenantId)),
    );
  res.json({ deleted: r.rowCount });
});

export default router;
