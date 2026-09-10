import { Router } from "express";
import { routeParam } from "../utils/params.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { eq, lt } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { refreshTokens, users } from "../db/schema.js";
import { requireJwt } from "../middleware/auth.js";
import { hashRefreshToken } from "../utils/crypto.js";
import crypto from "crypto";

const router = Router();

/** Accepts dev addresses like admin@localhost (Zod .email() rejects those). */
const portalEmail = z
  .string()
  .min(3)
  .max(320)
  .refine((v) => /^[^\s@]+@[^\s@]+$/.test(v), { message: "invalid email" });

const loginSchema = z.object({
  email: portalEmail,
  password: z.string().min(1),
});

function userPayload(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    tenant_id: user.tenantId,
  };
}

async function issueAccessToken(user: typeof users.$inferSelect): Promise<string> {
  return jwt.sign(
    { sub: user.id, tid: user.tenantId, role: user.role, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtAccessTtlSec },
  );
}

/** Drop expired refresh rows (housekeeping; safe to call on login). */
async function purgeExpiredRefreshTokens(): Promise<void> {
  const db = getDb();
  await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, new Date()));
}

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    res.status(400).json({
      error: "validation_failed",
      message: Object.values(flat.fieldErrors).flat().join("; ") || "Invalid request",
      details: flat,
    });
    return;
  }
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  await purgeExpiredRefreshTokens();
  const access = await issueAccessToken(user);
  const refreshRaw = crypto.randomBytes(32).toString("hex");
  const sessionExpires = new Date(Date.now() + config.jwtRefreshTtlSec * 1000);
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshRaw),
    expiresAt: sessionExpires,
  });
  await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));
  res.json({
    access_token: access,
    refresh_token: refreshRaw,
    expires_in: config.jwtAccessTtlSec,
    refresh_expires_at: sessionExpires.toISOString(),
    user: userPayload(user),
  });
});

router.get("/session", requireJwt, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
      tenant_id: req.user!.tenantId,
    },
  });
});

const refreshSchema = z.object({ refresh_token: z.string().min(1) });

router.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const hash = hashRefreshToken(parsed.data.refresh_token);
  const row = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, hash),
  });
  if (!row || row.expiresAt < new Date()) {
    if (row) {
      await db.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
    }
    res.status(401).json({ error: "invalid refresh token" });
    return;
  }
  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user) {
    await db.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
    res.status(401).json({ error: "user not found" });
    return;
  }
  const sessionExpires = new Date(Date.now() + config.jwtRefreshTtlSec * 1000);
  await db
    .update(refreshTokens)
    .set({ expiresAt: sessionExpires })
    .where(eq(refreshTokens.id, row.id));
  const access = await issueAccessToken(user);
  res.json({
    access_token: access,
    expires_in: config.jwtAccessTtlSec,
    refresh_expires_at: sessionExpires.toISOString(),
    user: userPayload(user),
  });
});

const logoutSchema = z.object({
  refresh_token: z.string().min(1).optional(),
});

router.post("/logout", async (req, res) => {
  const parsed = logoutSchema.safeParse(req.body ?? {});
  const db = getDb();
  if (parsed.success && parsed.data.refresh_token) {
    const hash = hashRefreshToken(parsed.data.refresh_token);
    await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, hash));
  }
  res.json({ ok: true });
});

router.post("/totp/setup", requireJwt, async (req, res) => {
  const { authenticator } = await import("otplib");
  const secret = authenticator.generateSecret();
  const db = getDb();
  await db.update(users).set({ totpSecret: secret }).where(eq(users.id, req.user!.id));
  const label = encodeURIComponent(req.user!.email);
  const issuer = encodeURIComponent("oc-controller");
  const otpauth = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}`;
  res.json({ secret, otpauth_url: otpauth });
});

router.post("/totp/verify", requireJwt, async (req, res) => {
  const parsed = z.object({ code: z.string().length(6) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
  if (!user?.totpSecret) {
    res.status(400).json({ error: "totp not configured" });
    return;
  }
  const { authenticator } = await import("otplib");
  const ok = authenticator.check(parsed.data.code, user.totpSecret);
  res.json({ ok });
});

router.post("/verify-sms", async (req, res) => {
  const parsed = z
    .object({ phone: z.string(), code: z.string() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!config.twilioAccountSid || !config.twilioVerifyServiceSid) {
    res.status(503).json({ error: "sms verification not configured" });
    return;
  }
  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
  const url = `https://verify.twilio.com/v2/Services/${config.twilioVerifyServiceSid}/VerificationCheck`;
  const body = new URLSearchParams({
    To: parsed.data.phone,
    Code: parsed.data.code,
  });
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await r.json()) as { status?: string };
  res.json({ ok: r.ok && data.status === "approved", status: data.status });
});

export default router;
