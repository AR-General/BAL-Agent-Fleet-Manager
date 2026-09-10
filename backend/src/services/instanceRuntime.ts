import { classifyBotRuntime, type BotRuntimeKind } from "./botRuntime.js";
import {
  attachFallbackUrls,
  buildHermesInstanceUrls,
  buildOpenAiLikeUrls,
  normalizeOpenAiApiBase,
} from "../utils/instanceEndpoints.js";
import { defaultUrls, portsFromSlot, type InstancePorts } from "../utils/ports.js";
import { normalizeTls, type InstanceTls } from "../utils/instanceTls.js";

export type RuntimeRegisterInput = {
  runtime?: unknown;
  name?: string;
  host?: string;
  fallbackHost?: string;
  ports?: Record<string, unknown>;
  urls?: Record<string, string>;
  identity?: Record<string, unknown>;
  tls?: InstanceTls;
  apiBase?: string;
  apiPort?: number;
  httpsPort?: number;
  healthPath?: string;
  defaultModel?: string;
};

export type RuntimeRegisterResult = {
  runtime: BotRuntimeKind;
  identity: Record<string, unknown>;
  ports: InstancePorts;
  urls: Record<string, string>;
  host: string;
  tls: InstanceTls;
};

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function buildRuntimeRegistration(input: RuntimeRegisterInput): RuntimeRegisterResult {
  const identityIn = { ...(input.identity || {}) };
  const runtime = classifyBotRuntime(input.runtime ?? identityIn.runtime);
  const name = (input.name || String(identityIn.name || identityIn.display_name || "")).trim();
  const host = String(input.host || "").trim() || "127.0.0.1";
  const fallbackHost = String(input.fallbackHost || identityIn.fallback_host || "").trim();
  const tls = normalizeTls(input.tls);
  const defaultModel = (input.defaultModel || String(identityIn.default_model || "")).trim();
  const rawPorts = (input.ports || {}) as Record<string, unknown>;

  const identity: Record<string, unknown> = {
    ...identityIn,
    runtime,
    ...(name ? { name, display_name: name } : {}),
    ...(fallbackHost ? { fallback_host: fallbackHost } : {}),
    ...(defaultModel ? { default_model: defaultModel } : {}),
  };

  if (runtime === "hermes") {
    const apiPort = num(input.apiPort) ?? num(rawPorts.api) ?? num(rawPorts.gateway) ?? 18789;
    const httpsPort = num(input.httpsPort) ?? num(rawPorts.https) ?? apiPort + 1000;
    const healthPath = (input.healthPath || String(identityIn.health_path || "/health")).trim() || "/health";
    identity.health_path = healthPath;
    const built = buildHermesInstanceUrls({ host, fallbackHost, apiPort, httpsPort });
    const urls = { ...built, ...(input.urls || {}) };
    return {
      runtime,
      identity,
      ports: { slot: num(rawPorts.slot) ?? 0, api: apiPort, gateway: apiPort, https: httpsPort } as InstancePorts,
      urls,
      host,
      tls,
    };
  }

  if (runtime === "openai-like") {
    const apiBase = normalizeOpenAiApiBase(
      input.apiBase || input.urls?.api_base || String(identityIn.api_base || ""),
    );
    if (!apiBase) {
      throw Object.assign(new Error("api_base required for openai-like runtime"), { status: 400 });
    }
    const healthPath =
      (input.healthPath || String(identityIn.health_path || "/v1/models")).trim() || "/v1/models";
    identity.health_path = healthPath;
    identity.api_base = apiBase;
    const built = buildOpenAiLikeUrls({ apiBase, fallbackHost });
    const urls = { ...built, ...(input.urls || {}), api_base: apiBase };
    let derivedHost = host;
    try {
      derivedHost = new URL(apiBase).hostname || host;
    } catch {
      derivedHost = host;
    }
    return {
      runtime,
      identity,
      ports: {},
      urls,
      host: derivedHost,
      tls,
    };
  }

  const slot = num(rawPorts.slot) ?? 0;
  let ports: InstancePorts = portsFromSlot(slot);
  if (rawPorts.gateway || rawPorts.https || rawPorts.bridge) {
    ports = {
      ...ports,
      slot,
      gateway: num(rawPorts.gateway) ?? ports.gateway,
      bridge: num(rawPorts.bridge) ?? ports.bridge,
      https: num(rawPorts.https) ?? ports.https,
      bridge_https: num(rawPorts.bridge_https) ?? ports.bridge_https,
      signal: num(rawPorts.signal) ?? ports.signal,
      twilio: num(rawPorts.twilio) ?? ports.twilio,
      ollama: num(rawPorts.ollama) ?? ports.ollama,
    };
  }
  identity.health_path =
    (input.healthPath || String(identityIn.health_path || "/healthz")).trim() || "/healthz";
  const urls = {
    ...defaultUrls(host, ports, { gatewayHttps: tls.gateway_https }),
    ...(input.urls || {}),
  };
  return {
    runtime,
    identity,
    ports,
    urls: fallbackHost ? attachFallbackUrls(urls, fallbackHost) : urls,
    host,
    tls,
  };
}
