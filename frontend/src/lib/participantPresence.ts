export type AgentPresence = {
  slug: string;
  online: boolean;
  status: string;
  latency_ms: number | null;
  last_seen: string | null;
  error?: string;
};

export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${Math.round(ms)}ms`;
}

export function presenceTone(status?: string, online?: boolean): "healthy" | "degraded" | "down" {
  if (online === false) return "down";
  const s = status || "unknown";
  if (s === "healthy" || s === "ok") return "healthy";
  if (s === "down" || s === "error") return "down";
  return "degraded";
}

export function presenceLabel(row?: AgentPresence | null): string {
  if (!row) return "unknown";
  if (!row.online) return "offline";
  if (row.status === "degraded") return "degraded";
  return "online";
}

export function presenceToneHex(tone: "healthy" | "degraded" | "down"): number {
  if (tone === "healthy") return 0x3dd68c;
  if (tone === "degraded") return 0xf5c542;
  return 0xff6666;
}

export function presenceFromInstance(inst: {
  slug: string;
  lastSeen?: string | null;
  health?: {
    status?: string;
    response_time_ms?: number | null;
    last_ping?: string | null;
    last_error?: string | null;
  };
}): AgentPresence {
  const status = inst.health?.status || "unknown";
  const online = status === "healthy" || status === "ok" || status === "degraded";
  const ms = inst.health?.response_time_ms;
  return {
    slug: inst.slug,
    online,
    status,
    latency_ms: online && typeof ms === "number" && Number.isFinite(ms) ? ms : null,
    last_seen: inst.health?.last_ping || inst.lastSeen || null,
    error: inst.health?.last_error || undefined,
  };
}
