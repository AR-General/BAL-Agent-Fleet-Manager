import type { DbInstance } from "../types";

export function instanceDisplayName(inst: DbInstance): string {
  const id = inst.identity || {};
  const name = id.name ?? id.display_name ?? id.public_name;
  return String(name || inst.slug);
}

export function healthClass(inst: DbInstance | { health?: { status?: string } }): string {
  const s = inst.health?.status || "unknown";
  if (s === "healthy" || s === "ok") return "healthy";
  if (s === "down" || s === "error") return "down";
  if (s === "degraded" || s === "warn") return "degraded";
  return "degraded";
}

export function formatTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export function parseJsonField(raw: string): Record<string, unknown> {
  const t = raw.trim();
  if (!t) return {};
  return JSON.parse(t) as Record<string, unknown>;
}
