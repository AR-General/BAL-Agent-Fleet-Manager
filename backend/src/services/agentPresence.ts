export type AgentPresence = {
  slug: string;
  online: boolean;
  status: string;
  latency_ms: number | null;
  last_seen: string | null;
  error?: string;
};

export type PresencePing = {
  ok: boolean;
  ms: number;
  status: string;
  error?: string;
};

export function isReachableHealthStatus(status: string, ok: boolean): boolean {
  if (!ok) return false;
  return status === "healthy" || status === "ok" || status === "degraded";
}

export function presenceFromPing(
  slug: string,
  ping: PresencePing,
  lastSeen?: Date | string | null,
): AgentPresence {
  const online = isReachableHealthStatus(ping.status, ping.ok);
  const last =
    lastSeen instanceof Date ? lastSeen.toISOString() : lastSeen ? String(lastSeen) : null;
  return {
    slug,
    online,
    status: ping.status || (ping.ok ? "healthy" : "down"),
    latency_ms: online ? ping.ms : null,
    last_seen: ping.ok ? new Date().toISOString() : last,
    error: ping.error,
  };
}

export function presenceFromStoredHealth(
  slug: string,
  health: Record<string, unknown> | null | undefined,
  lastSeen?: Date | string | null,
): AgentPresence {
  const status = typeof health?.status === "string" ? health.status : "unknown";
  const ok = status === "healthy" || status === "ok" || status === "degraded";
  const rawMs = health?.response_time_ms;
  const ms = typeof rawMs === "number" && Number.isFinite(rawMs) ? rawMs : null;
  const last =
    lastSeen instanceof Date ? lastSeen.toISOString() : lastSeen ? String(lastSeen) : null;
  const lastPing = typeof health?.last_ping === "string" ? health.last_ping : last;
  return {
    slug,
    online: ok,
    status,
    latency_ms: ok ? ms : null,
    last_seen: lastPing,
    error: typeof health?.last_error === "string" ? health.last_error : undefined,
  };
}
