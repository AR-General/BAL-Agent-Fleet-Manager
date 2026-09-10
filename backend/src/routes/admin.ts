import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { instances } from "../db/schema.js";
import { requireJwt, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/:slug/signal/qr", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  const signalUrl = (inst?.urls as Record<string, string> | undefined)?.signal_rest;
  if (!signalUrl) {
    res.status(400).json({ error: "signal_rest URL not configured" });
    return;
  }
  try {
    const r = await fetch(`${signalUrl.replace(/\/$/, "")}/v1/qrcodelink?device_name=oc-controller`, {
      signal: AbortSignal.timeout(30_000),
    });
    res.json({ qr: await r.json() });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/:slug/twilio/save", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const { account_sid, phone, bridge_public_url } = req.body as Record<string, string>;
  const db = getDb();
  await db
    .update(instances)
    .set({
      channels: {
        twilio: { enabled: true, account_sid, phone, bridge_url: bridge_public_url },
      },
    })
    .where(and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)));
  res.json({
    ok: true,
    webhooks: {
      voice_inbound: `${bridge_public_url?.replace(/\/$/, "")}/voice/inbound`,
      messaging: `${bridge_public_url?.replace(/\/$/, "")}/messaging/whatsapp`,
    },
  });
});

export default router;
