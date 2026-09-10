import { and, eq, inArray } from "drizzle-orm";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { instances } from "../db/schema.js";
import { fetchHealthz, resolveHealthUrl } from "../utils/httpFetch.js";
import {
  httpWarningForUrl,
  resolveHealthUrlCandidates,
} from "../utils/instanceEndpoints.js";
import { parseInstanceTls, tlsSelfSignedWarning } from "../utils/instanceTls.js";
import { log } from "../utils/logger.js";
import { incMetric } from "../utils/metrics.js";
import { presenceFromPing, type AgentPresence } from "./agentPresence.js";

function nextStatus(failures: number, ok: boolean): string {
  if (ok) return "healthy";
  if (failures >= 5) return "down";
  if (failures >= 3) return "degraded";
  return failures > 0 ? "degraded" : "unknown";
}

export type PingResult = {
  ok: boolean;
  ms: number;
  url: string;
  status: string;
  error?: string;
  tls_warning?: string;
  tls_hint?: string;
  http_warning?: string;
  used_fallback?: boolean;
  changed?: boolean;
};

function healthFingerprint(h: Record<string, unknown>): string {
  return JSON.stringify({
    status: h.status ?? null,
    last_error: h.last_error ?? null,
    consecutive_failures: h.consecutive_failures ?? 0,
    tls_warning: h.tls_warning ?? null,
    http_warning: h.http_warning ?? null,
    used_fallback: h.used_fallback ?? false,
    active_url: h.active_url ?? null,
  });
}

export async function pingInstanceRecord(
  inst: typeof instances.$inferSelect,
): Promise<PingResult> {
  const db = getDb();
  const urls = (inst.urls || {}) as Record<string, string>;
  const identity = (inst.identity || {}) as Record<string, unknown>;
  const candidates = resolveHealthUrlCandidates(urls, identity);
  const primary = candidates[0] || resolveHealthUrl(urls, identity);
  if (!primary?.url && !candidates.length) {
    return {
      ok: false,
      ms: 0,
      url: "",
      status: "unknown",
      error: "gateway_intranet / health URL not set",
    };
  }
  const tls = parseInstanceTls(inst);
  const now = new Date();
  const prevHealth = (inst.health || {}) as Record<string, unknown>;
  const prev = Number(prevHealth.consecutive_failures || 0);

  let result = await fetchHealthz(primary.url, {
    allowSelfSigned: tls.allow_self_signed,
    healthPath: primary.path,
  });
  let usedFallback = false;
  let lastError = result.error;
  for (let i = 1; i < candidates.length && !result.ok; i++) {
    const next = candidates[i];
    const retry = await fetchHealthz(next.url, {
      allowSelfSigned: tls.allow_self_signed,
      healthPath: next.path,
    });
    if (retry.ok) {
      usedFallback = true;
      lastError = result.error;
      result = retry;
      incMetric(
        "oc_health_endpoint_fallback_total",
        "Health probes that succeeded on a fallback host",
      );
      log.warn(
        { slug: inst.slug, from: primary.url, to: next.url },
        "health probe succeeded on fallback endpoint",
      );
      break;
    }
    lastError = retry.error;
    result = retry;
  }

  const failures = result.ok ? 0 : prev + 1;
  const status = result.ok && usedFallback ? "degraded" : nextStatus(failures, result.ok);
  const storedWarning = result.ok
    ? tlsSelfSignedWarning(tls) ?? result.tls_warning
    : result.tls_warning;
  const httpWarning = result.ok ? httpWarningForUrl(result.url) : undefined;

  const nextHealth: Record<string, unknown> = {
    status,
    last_ping: now.toISOString(),
    last_error: result.ok ? (usedFallback ? lastError ?? null : null) : result.error ?? null,
    response_time_ms: result.ms,
    consecutive_failures: failures,
    tls_warning: storedWarning ?? null,
    http_warning: httpWarning ?? null,
    used_fallback: usedFallback,
    active_url: result.url || null,
  };

  const changed = healthFingerprint(prevHealth) !== healthFingerprint(nextHealth);

  // Always persist last_ping + RTT so chat presence can show current latency.
  await db
    .update(instances)
    .set({
      health: nextHealth,
      ...(result.ok ? { lastSeen: now } : {}),
    })
    .where(eq(instances.id, inst.id));

  return {
    ok: result.ok,
    ms: result.ms,
    url: result.url,
    status,
    error: result.ok && usedFallback ? lastError : result.error,
    tls_warning: storedWarning,
    tls_hint: result.tls_hint,
    http_warning: httpWarning,
    used_fallback: usedFallback,
    changed,
  };
}

const PRESENCE_SLUG_LIMIT = 24;

/** Live-probe selected fleet slugs (chat group roster). Preserves request order. */
export async function presenceForSlugs(slugs: string[], tenantId: string): Promise<AgentPresence[]> {
  const unique = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))].slice(0, PRESENCE_SLUG_LIMIT);
  if (!unique.length) return [];

  const db = getDb();
  const rows = await db
    .select()
    .from(instances)
    .where(and(eq(instances.tenantId, tenantId), inArray(instances.slug, unique)));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const byOrder = new Map<string, AgentPresence>();

  await Promise.all(
    unique.map(async (slug) => {
      const inst = bySlug.get(slug);
      if (!inst) {
        byOrder.set(slug, {
          slug,
          online: false,
          status: "unknown",
          latency_ms: null,
          last_seen: null,
          error: "instance not found",
        });
        return;
      }
      try {
        const ping = await pingInstanceRecord(inst);
        byOrder.set(slug, presenceFromPing(slug, ping, inst.lastSeen));
        incMetric("oc_health_presence_probe_total", "Live presence probes for chat participants");
      } catch (err) {
        log.error({ err, slug }, "presence probe failed");
        byOrder.set(slug, {
          slug,
          online: false,
          status: "down",
          latency_ms: null,
          last_seen: inst.lastSeen?.toISOString() ?? null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  return unique.map((slug) => byOrder.get(slug)!);
}

export async function pingAllInstances(): Promise<void> {
  let list: (typeof instances.$inferSelect)[];
  try {
    const db = getDb();
    list = await db.select().from(instances);
  } catch (err) {
    log.error({ err }, "health pinger failed to load instances");
    return;
  }

  let changedCount = 0;
  let failCount = 0;
  for (const inst of list) {
    try {
      const r = await pingInstanceRecord(inst);
      if (!r.ok) failCount += 1;
      if (r.changed) {
        changedCount += 1;
        if (!r.ok) {
          log.warn({ slug: inst.slug, status: r.status, error: r.error }, "health status changed");
        } else {
          log.info({ slug: inst.slug, status: r.status }, "health status changed");
        }
      }
    } catch (err) {
      log.error({ err, slug: inst.slug }, "health ping threw");
    }
  }

  if (failCount > 0 && changedCount === 0) {
    log.debug(
      { failCount, total: list.length },
      "health ping cycle: failures unchanged",
    );
  }
}

async function runPingCycle(): Promise<void> {
  try {
    await pingAllInstances();
  } catch (err) {
    log.error({ err }, "health pinger cycle failed");
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startHealthPinger(): void {
  if (timer) return;
  void runPingCycle();
  timer = setInterval(() => void runPingCycle(), config.healthPingIntervalMs);
  log.info({ intervalMs: config.healthPingIntervalMs }, "health pinger started");
}

export function stopHealthPinger(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
