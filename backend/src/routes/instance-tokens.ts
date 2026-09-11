import { Router } from "express";
import { routeParam } from "../utils/params.js";
import bcrypt from "bcrypt";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { instanceApiTokens, instances } from "../db/schema.js";
import { requireJwt, requireRole } from "../middleware/auth.js";
import { generateInstanceToken } from "../utils/crypto.js";

const router = Router({ mergeParams: true });

const DEFAULT_SCOPES = [
  "fleet:read",
  "fleet:write",
  "events:push",
  "messages:send",
  "chat:read",
  "chat:post",
  "contacts:read",
  "tools:invoke",
];

const createSchema = z.object({
  label: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  expires_at: z.string().datetime().optional(),
});

router.get("/", requireJwt, async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }
  const tokens = await db
    .select({
      id: instanceApiTokens.id,
      label: instanceApiTokens.label,
      tokenPrefix: instanceApiTokens.tokenPrefix,
      scopes: instanceApiTokens.scopes,
      expiresAt: instanceApiTokens.expiresAt,
      revokedAt: instanceApiTokens.revokedAt,
      lastUsedAt: instanceApiTokens.lastUsedAt,
      createdAt: instanceApiTokens.createdAt,
    })
    .from(instanceApiTokens)
    .where(eq(instanceApiTokens.instanceId, inst.id));
  res.json({ tokens });
});

router.post("/", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }
  const { raw, prefix } = generateInstanceToken();
  const hash = await bcrypt.hash(raw, 12);
  const [row] = await db
    .insert(instanceApiTokens)
    .values({
      instanceId: inst.id,
      label: parsed.data.label,
      tokenPrefix: prefix,
      tokenHash: hash,
      scopes: parsed.data.scopes || DEFAULT_SCOPES,
      createdByUserId: req.user!.id,
      expiresAt: parsed.data.expires_at ? new Date(parsed.data.expires_at) : null,
    })
    .returning();
  res.status(201).json({
    ok: true,
    token: raw,
    token_once: "Store this token now; it will not be shown again.",
    entry: row,
    env_hint: `OC_CONTROLLER_API_KEY=${raw}`,
  });
});

router.delete("/:tokenId", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, routeParam(req.params.slug)), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }
  await db
    .update(instanceApiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(instanceApiTokens.id, routeParam(req.params.tokenId)),
        eq(instanceApiTokens.instanceId, inst.id),
        isNull(instanceApiTokens.revokedAt),
      ),
    );
  res.json({ ok: true });
});

export default router;
