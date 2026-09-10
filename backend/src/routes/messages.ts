import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { contactChannels, contacts, fleetMessages, instances } from "../db/schema.js";
import { requireInstanceAuth, requireJwt } from "../middleware/auth.js";
import { executeTool } from "../services/toolExecutor.js";
import { decryptText } from "../utils/crypto.js";

const router = Router();

router.post("/send", requireInstanceAuth, async (req, res) => {
  const parsed = z
    .object({
      from_slug: z.string(),
      to_slug: z.string().optional(),
      to_contact_slug: z.string().optional(),
      body: z.string().min(1),
      channel: z.string().default("oc-controller"),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const result = await executeTool(
    "fleet_send_message",
    {
      to_slug: parsed.data.to_slug,
      to_contact_slug: parsed.data.to_contact_slug,
      body: parsed.data.body,
      channel: parsed.data.channel,
    },
    { instance: req.authInstance },
  );
  res.json(result);
});

router.get("/:slug/inbox", requireInstanceAuth, async (req, res) => {
  const result = await executeTool("fleet_check_inbox", {}, { instance: req.authInstance });
  res.json(result);
});

router.get("/:slug/contacts", requireJwt, async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: eq(instances.slug, routeParam(req.params.slug)),
  });
  if (!inst) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const linked = await db
    .select()
    .from(contacts)
    .where(eq(contacts.linkedInstanceId, inst.id));
  res.setHeader("Deprecation", "true");
  res.json({
    instance_slug: inst.slug,
    contacts: linked.map((c) => ({
      slug: c.slug,
      display_name: c.displayName,
      channels: [],
    })),
  });
});

export default router;
