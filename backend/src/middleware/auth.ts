import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { eq, and, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { instanceApiTokens, instances } from "../db/schema.js";

export interface AuthUser {
  id: string;
  tenantId: string;
  role: "admin" | "operator" | "viewer";
  email: string;
}

export interface AuthInstance {
  id: string;
  slug: string;
  tenantId: string;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authInstance?: AuthInstance;
    }
  }
}

function bearer(req: Request): string {
  return req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
}

export function requireJwt(req: Request, res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      sub: string;
      tid: string;
      role: AuthUser["role"];
      email: string;
    };
    req.user = {
      id: payload.sub,
      tenantId: payload.tid,
      role: payload.role,
      email: payload.email,
    };
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}

export function requireRole(...roles: AuthUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}

export async function requireInstanceAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = bearer(req);
  if (!auth) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  if (config.controllerSecret && auth === config.controllerSecret) {
    const slug = (req.headers["x-instance-slug"] as string) || "unknown";
    const db = getDb();
    const row = await db.query.instances.findFirst({
      where: eq(instances.slug, slug),
    });
    if (row) {
      req.authInstance = {
        id: row.id,
        slug: row.slug,
        tenantId: row.tenantId,
        scopes: ["fleet:read", "fleet:write", "events:push", "messages:send", "chat:read", "chat:post", "contacts:read", "tools:invoke"],
      };
    }
    next();
    return;
  }

  if (auth.startsWith("oc_inst_")) {
    const db = getDb();
    const prefix = auth.slice(0, 12);
    const tokens = await db
      .select()
      .from(instanceApiTokens)
      .where(and(isNull(instanceApiTokens.revokedAt), eq(instanceApiTokens.tokenPrefix, prefix)));
    for (const t of tokens) {
      const ok = await bcrypt.compare(auth, t.tokenHash);
      if (ok) {
        const inst = await db.query.instances.findFirst({
          where: eq(instances.id, t.instanceId),
        });
        if (!inst) break;
        if (t.expiresAt && t.expiresAt < new Date()) {
          res.status(401).json({ error: "token expired" });
          return;
        }
        req.authInstance = {
          id: inst.id,
          slug: inst.slug,
          tenantId: inst.tenantId,
          scopes: t.scopes || [],
        };
        next();
        return;
      }
    }
  }

  res.status(403).json({ error: "invalid instance token" });
}

export function requireJwtOrInstance(req: Request, res: Response, next: NextFunction): void {
  const auth = bearer(req);
  if (!auth) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }
  if (!auth.startsWith("oc_inst_")) {
    try {
      const payload = jwt.verify(auth, config.jwtSecret) as {
        sub: string;
        tid: string;
        role: AuthUser["role"];
        email: string;
      };
      req.user = {
        id: payload.sub,
        tenantId: payload.tid,
        role: payload.role,
        email: payload.email,
      };
      next();
      return;
    } catch {
      res.status(401).json({ error: "invalid token" });
      return;
    }
  }
  void requireInstanceAuth(req, res, next);
}

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const scopes = req.authInstance?.scopes || [];
    if (!scopes.includes(scope) && !scopes.includes("tools:invoke")) {
      res.status(403).json({ error: `missing scope: ${scope}` });
      return;
    }
    next();
  };
}
