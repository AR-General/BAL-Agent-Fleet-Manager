import fs from "fs";
import path from "path";
import { config } from "../config.js";

export type AuditEntry = {
  ts: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  ip?: string;
  user_id?: string;
  user_email?: string;
  instance_slug?: string;
};

let pruneTimer: ReturnType<typeof setInterval> | null = null;

function auditDir(): string {
  return path.resolve(config.auditLogDir);
}

function dailyFile(date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return path.join(auditDir(), `requests-${d}.jsonl`);
}

export function ensureAuditLogDir(): void {
  if (!config.auditLogEnabled) return;
  fs.mkdirSync(auditDir(), { recursive: true });
}

export function appendRequestAudit(entry: AuditEntry): void {
  if (!config.auditLogEnabled) return;
  try {
    ensureAuditLogDir();
    fs.appendFileSync(dailyFile(), `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    /* best-effort; do not break requests */
  }
}

export function pruneAuditLogs(): void {
  if (!config.auditLogEnabled) return;
  const dir = auditDir();
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - config.auditLogRetentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    const m = /^requests-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!m) continue;
    const fileDate = new Date(`${m[1]}T00:00:00Z`).getTime();
    if (fileDate < cutoff) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* ignore */
      }
    }
  }
}

export function startAuditLogMaintenance(): void {
  if (!config.auditLogEnabled) return;
  ensureAuditLogDir();
  pruneAuditLogs();
  if (pruneTimer) return;
  pruneTimer = setInterval(pruneAuditLogs, 6 * 60 * 60 * 1000);
  pruneTimer.unref?.();
}

export function stopAuditLogMaintenance(): void {
  if (pruneTimer) clearInterval(pruneTimer);
  pruneTimer = null;
}
