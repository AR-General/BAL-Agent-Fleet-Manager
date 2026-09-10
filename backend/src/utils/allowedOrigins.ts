import type { InstancePorts } from "./ports.js";

export type AllowedOriginsInput = {
  host: string;
  ports: InstancePorts;
  /** op-controller HTTP port(s) users open in the browser */
  opControllerHttpPorts?: number[];
  /** op-controller HTTPS port(s) */
  opControllerHttpsPorts?: number[];
  /** Hostname for op-controller (defaults to fleet host) */
  opControllerPublicHost?: string;
  extra?: string[];
};

const DEFAULT_OC_HTTP_PORTS = [3822, 3820];
const DEFAULT_OC_HTTPS_PORTS = [3821];

function originUrl(scheme: "http" | "https", hostname: string, port: number): string {
  return `${scheme}://${hostname}:${port}`;
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const o = item.replace(/\/$/, "");
    if (o && !seen.has(o)) {
      seen.add(o);
      out.push(o);
    }
  }
  return out;
}

/** Mirrors openclaw-template/scripts/configure-from-env.sh gateway.controlUi.allowedOrigins */
export function buildAllowedOrigins(input: AllowedOriginsInput): string[] {
  const host = input.host.replace(/\/$/, "");
  const slot = input.ports.slot ?? 0;
  const gw = input.ports.gateway ?? 18789 + slot * 100;
  const httpsPort = input.ports.https ?? 8443 + slot * 100;
  const bridgeHttps = input.ports.bridge_https ?? httpsPort + 1;
  const ocHost = (input.opControllerPublicHost || host).replace(/\/$/, "");
  const ocHttp = input.opControllerHttpPorts?.length ? input.opControllerHttpPorts : DEFAULT_OC_HTTP_PORTS;
  const ocHttps = input.opControllerHttpsPorts?.length ? input.opControllerHttpsPorts : DEFAULT_OC_HTTPS_PORTS;

  const origins: string[] = [];

  for (const h of ["127.0.0.1", "localhost"]) {
    origins.push(originUrl("http", h, gw), originUrl("https", h, httpsPort), originUrl("https", h, bridgeHttps));
    for (const p of ocHttp) origins.push(originUrl("http", h, p));
    for (const p of ocHttps) origins.push(originUrl("https", h, p));
  }

  if (host) {
    origins.push(
      originUrl("http", host, gw),
      originUrl("https", host, httpsPort),
      originUrl("https", host, bridgeHttps),
    );
    for (const p of ocHttp) origins.push(originUrl("http", ocHost, p));
    for (const p of ocHttps) origins.push(originUrl("https", ocHost, p));
  }

  if (input.extra?.length) {
    for (const e of input.extra) {
      if (e.trim()) origins.push(e.trim().replace(/\/$/, ""));
    }
  }

  return uniq(origins);
}
