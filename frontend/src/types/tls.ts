export type InstanceTls = {
  gateway_https?: boolean;
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

export function tlsSelfSignedWarning(tls: Required<InstanceTls>): string | undefined {
  if (!tls.allow_self_signed) return undefined;
  return (
    "TLS certificate verification is disabled for this instance. " +
    "Health checks accept self-signed or untrusted certificates. " +
    "Use only on trusted networks."
  );
}
