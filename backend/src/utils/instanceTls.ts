import type { instances } from "../db/schema.js";

export type InstanceTls = {
  /** Probe gateway via https://host:https_port (nginx TLS front). Default true for new registrations. */
  gateway_https?: boolean;
  /** Skip TLS certificate verification for gateway/bridge HTTPS probes and proxy calls. */
  allow_self_signed?: boolean;
};

export const DEFAULT_INSTANCE_TLS: Required<InstanceTls> = {
  gateway_https: true,
  allow_self_signed: false,
};

export function normalizeTls(raw?: InstanceTls | null): Required<InstanceTls> {
  return {
    gateway_https: raw?.gateway_https ?? DEFAULT_INSTANCE_TLS.gateway_https,
    allow_self_signed: raw?.allow_self_signed ?? DEFAULT_INSTANCE_TLS.allow_self_signed,
  };
}

export function parseInstanceTls(row: {
  tls?: unknown;
  identity?: Record<string, unknown> | null;
}): Required<InstanceTls> {
  if (row.tls && typeof row.tls === "object" && !Array.isArray(row.tls)) {
    return normalizeTls(row.tls as InstanceTls);
  }
  const fromIdentity = row.identity?.tls;
  if (fromIdentity && typeof fromIdentity === "object" && !Array.isArray(fromIdentity)) {
    return normalizeTls(fromIdentity as InstanceTls);
  }
  return { ...DEFAULT_INSTANCE_TLS };
}

export function tlsSelfSignedWarning(tls: Required<InstanceTls>): string | undefined {
  if (!tls.allow_self_signed) return undefined;
  return (
    "TLS certificate verification is disabled for this instance. " +
    "Health checks and API calls accept self-signed or untrusted certificates. " +
    "Use only on trusted networks; replace with a proper CA certificate in production."
  );
}

export type InstanceRow = typeof instances.$inferSelect;
