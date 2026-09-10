import { config } from "../config.js";
import type { instances } from "../db/schema.js";
import { decryptSecret, encryptSecret } from "../utils/secretStorage.js";

type InstanceRow = typeof instances.$inferSelect;

function slugEnvKey(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

/** Per-instance env override, e.g. OC_ALPHA_GATEWAY_TOKEN for slug alpha. */
function envTokenForSlug(slug: string): string {
  const base = slugEnvKey(slug);
  return (
    process.env[`OC_${base}_GATEWAY_TOKEN`]?.trim() ||
    process.env[`${base}_GATEWAY_TOKEN`]?.trim() ||
    ""
  );
}

export function encryptGatewayToken(plaintext: string): string {
  return encryptSecret(plaintext.trim());
}

export function resolveGatewayToken(instance: Pick<InstanceRow, "slug" | "gatewayTokenEncrypted">): string {
  if (instance.gatewayTokenEncrypted) {
    try {
      const token = decryptSecret(instance.gatewayTokenEncrypted).trim();
      if (token) return token;
    } catch {
      /* fall through to env */
    }
  }
  const fromSlug = envTokenForSlug(instance.slug);
  if (fromSlug) return fromSlug;
  return config.defaultGatewayToken.trim();
}

export function instanceHasGatewayToken(
  instance: Pick<InstanceRow, "slug" | "gatewayTokenEncrypted">,
): boolean {
  return Boolean(resolveGatewayToken(instance));
}
