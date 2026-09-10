import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { agentProfiles, contactChannels, contacts, instances } from "../db/schema.js";
import { requireJwt, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/", requireJwt, async (req, res) => {
  const db = getDb();
  const q = req.query;
  let rows = await db.select().from(contacts).where(eq(contacts.tenantId, req.user!.tenantId));
  if (q.kind) rows = rows.filter((c) => c.contactKind === q.kind);
  if (q.external === "true") rows = rows.filter((c) => c.isExternal);
  if (q.allow_contact === "false") rows = rows.filter((c) => !c.allowContact);
  res.json({ contacts: rows });
});

const contactSchema = z.object({
  slug: z.string(),
  display_name: z.string(),
  contact_kind: z.enum(["human", "ai_agent"]),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  is_external: z.boolean().optional(),
  allow_contact: z.boolean().optional(),
  linked_instance_slug: z.string().optional(),
  agent_id: z.string().optional(),
});

router.post("/", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  let linkedInstanceId: string | null = null;
  let linkedAgentProfileId: string | null = null;
  if (parsed.data.linked_instance_slug) {
    const inst = await db.query.instances.findFirst({
      where: and(
        eq(instances.slug, parsed.data.linked_instance_slug),
        eq(instances.tenantId, req.user!.tenantId),
      ),
    });
    if (inst) linkedInstanceId = inst.id;
    if (parsed.data.agent_id && inst) {
      const ap = await db.query.agentProfiles.findFirst({
        where: and(eq(agentProfiles.instanceId, inst.id), eq(agentProfiles.agentId, parsed.data.agent_id)),
      });
      if (ap) linkedAgentProfileId = ap.id;
    }
  }
  const [row] = await db
    .insert(contacts)
    .values({
      tenantId: req.user!.tenantId,
      slug: parsed.data.slug,
      displayName: parsed.data.display_name,
      contactKind: parsed.data.contact_kind,
      notes: parsed.data.notes,
      tags: parsed.data.tags,
      isExternal: parsed.data.is_external ?? false,
      allowContact: parsed.data.allow_contact ?? true,
      linkedInstanceId,
      linkedAgentProfileId,
    })
    .returning();
  res.status(201).json(row);
});

router.put("/:slug", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const c = await db.query.contacts.findFirst({
    where: and(eq(contacts.slug, routeParam(req.params.slug)), eq(contacts.tenantId, req.user!.tenantId)),
  });
  if (!c) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const allowed = [
    "display_name",
    "notes",
    "tags",
    "is_external",
    "allow_contact",
    "status",
  ] as const;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      const camel =
        k === "display_name"
          ? "displayName"
          : k === "is_external"
            ? "isExternal"
            : k === "allow_contact"
              ? "allowContact"
              : k;
      patch[camel] = req.body[k];
    }
  }
  const [row] = await db.update(contacts).set(patch).where(eq(contacts.id, c.id)).returning();
  res.json(row);
});

router.delete("/:slug", requireJwt, requireRole("admin"), async (req, res) => {
  const db = getDb();
  const r = await db
    .delete(contacts)
    .where(
      and(eq(contacts.slug, routeParam(req.params.slug)), eq(contacts.tenantId, req.user!.tenantId)),
    );
  res.json({ deleted: r.rowCount });
});

router.get("/:slug", requireJwt, async (req, res) => {
  const db = getDb();
  const c = await db.query.contacts.findFirst({
    where: and(eq(contacts.slug, routeParam(req.params.slug)), eq(contacts.tenantId, req.user!.tenantId)),
  });
  if (!c) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const ch = await db.select().from(contactChannels).where(eq(contactChannels.contactId, c.id));
  res.json({ contact: c, channels: ch });
});

const channelsSchema = z.object({
  channels: z.array(
    z.object({
      channel_type: z.string(),
      address: z.string(),
      label: z.string().optional(),
      priority: z.number().optional(),
      inbound_ok: z.boolean().optional(),
      outbound_ok: z.boolean().optional(),
      is_primary: z.boolean().optional(),
    }),
  ),
});

router.put("/:slug/channels", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = channelsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const c = await db.query.contacts.findFirst({
    where: and(eq(contacts.slug, routeParam(req.params.slug)), eq(contacts.tenantId, req.user!.tenantId)),
  });
  if (!c) {
    res.status(404).json({ error: "not found" });
    return;
  }
  await db.delete(contactChannels).where(eq(contactChannels.contactId, c.id));
  for (const ch of parsed.data.channels) {
    await db.insert(contactChannels).values({
      contactId: c.id,
      channelType: ch.channel_type as "phone",
      address: ch.address,
      label: ch.label,
      priority: ch.priority ?? 0,
      inboundOk: ch.inbound_ok ?? true,
      outboundOk: ch.outbound_ok ?? true,
      isPrimary: ch.is_primary ?? false,
    });
  }
  res.json({ ok: true });
});

router.post("/sync-agents", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const insts = await db.select().from(instances).where(eq(instances.tenantId, req.user!.tenantId));
  const created = [];
  for (const inst of insts) {
    const identity = (inst.identity || {}) as Record<string, unknown>;
    const slug = `agent-${inst.slug}`;
    const existing = await db.query.contacts.findFirst({
      where: and(eq(contacts.tenantId, req.user!.tenantId), eq(contacts.slug, slug)),
    });
    if (existing) continue;
    const [c] = await db
      .insert(contacts)
      .values({
        tenantId: req.user!.tenantId,
        slug,
        displayName: String(identity.public_name || inst.slug),
        contactKind: "ai_agent",
        allowContact: true,
        linkedInstanceId: inst.id,
      })
      .returning();
    created.push(c);
  }
  res.json({ ok: true, created: created.length });
});

export default router;
