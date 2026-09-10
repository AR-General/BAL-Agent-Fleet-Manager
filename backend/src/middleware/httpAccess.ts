import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { Logger } from "pino";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { appendRequestAudit } from "../services/requestAudit.js";

function shouldSkipAudit(req: Request): boolean {
  const p = req.path || req.url;
  if (req.method === "OPTIONS") return true;
  if (p === "/healthz") return true;
  if (!p.startsWith("/api/")) return true;
  return false;
}

function auditActor(req: Request): Pick<
  import("../services/requestAudit.js").AuditEntry,
  "user_id" | "user_email" | "instance_slug"
> {
  if (req.user) {
    return { user_id: req.user.id, user_email: req.user.email };
  }
  if (req.authInstance) {
    return { instance_slug: req.authInstance.slug };
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (token && !token.startsWith("oc_inst_")) {
    try {
      const payload = jwt.decode(token) as { sub?: string; email?: string } | null;
      if (payload?.sub) return { user_id: payload.sub, user_email: payload.email };
    } catch {
      /* ignore */
    }
  }
  return {};
}

function consoleLine(
  log: Logger,
  method: string,
  path: string,
  status: number,
  ms: number,
): void {
  const msg = `${method} ${path} ${status} ${ms}ms`;
  if (status >= 500) log.error({ method, path, status, ms }, msg);
  else if (status >= 400) log.warn({ method, path, status, ms }, msg);
  else if (config.httpAccessConsole === "all") log.info({ method, path, status, ms }, msg);
}

export function httpAccessMiddleware(log: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const path = req.originalUrl || req.url;

    res.on("finish", () => {
      const ms = Date.now() - start;
      const status = res.statusCode;

      if (!shouldSkipAudit(req)) {
        appendRequestAudit({
          ts: new Date().toISOString(),
          method: req.method,
          path,
          status,
          duration_ms: ms,
          ip: req.ip || req.socket.remoteAddress,
          ...auditActor(req),
        });
      }

      if (config.httpAccessConsole !== "off" && (!shouldSkipAudit(req) || status >= 400)) {
        consoleLine(log, req.method, path, status, ms);
      }
    });

    next();
  };
}
