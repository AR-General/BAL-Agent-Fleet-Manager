import type { DbInstance } from "../types/index.ts";
import type { InstancePorts } from "../types/ports.ts";
import { EMPTY_PORTS, portsToPayload } from "../types/ports.ts";
import type { InstanceTls } from "../types/tls.ts";
import { DEFAULT_INSTANCE_TLS, normalizeTls } from "../types/tls.ts";
import { classifyBotRuntime, type BotRuntimeKind } from "./botRuntime.ts";
import { buildHermesInstanceUrls, buildOpenAiLikeUrls, hostnameFromUrl } from "./instanceEndpoints.ts";

export type RuntimeFormValue = {
  runtime: BotRuntimeKind;
  displayName: string;
  host: string;
  fallbackHost: string;
  ports: InstancePorts;
  urls: Record<string, string>;
  tls: InstanceTls;
  gatewayToken: string;
  apiPort: number;
  httpsPort: number;
  healthPath: string;
  apiBase: string;
  defaultModel: string;
  identityExtra: Record<string, unknown>;
};

export function defaultHealthPath(runtime: BotRuntimeKind): string {
  if (runtime === "hermes") return "/health";
  if (runtime === "openai-like") return "/v1/models";
  return "/healthz";
}

const STOCK_HEALTH_PATHS = new Set(["/healthz", "/health", "/v1/models"]);

/** Keep custom probe paths; replace leftover defaults from another runtime. */
export function resolveHealthPath(runtime: BotRuntimeKind, healthPath: string): string {
  const trimmed = healthPath.trim();
  const expected = defaultHealthPath(runtime);
  if (!trimmed || (STOCK_HEALTH_PATHS.has(trimmed) && trimmed !== expected)) return expected;
  return trimmed;
}

export function emptyRuntimeForm(): RuntimeFormValue {
  return {
    runtime: "openclaw",
    displayName: "",
    host: "host.docker.internal",
    fallbackHost: "",
    ports: { ...EMPTY_PORTS },
    urls: {},
    tls: { ...DEFAULT_INSTANCE_TLS },
    gatewayToken: "",
    apiPort: 18789,
    httpsPort: 19789,
    healthPath: defaultHealthPath("openclaw"),
    apiBase: "https://api.openai.com/v1",
    defaultModel: "",
    identityExtra: {},
  };
}

function str(rec: Record<string, unknown> | undefined, key: string): string {
  const v = rec?.[key];
  return typeof v === "string" ? v : "";
}

export function runtimeFormFromInstance(inst: DbInstance): RuntimeFormValue {
  const identity = (inst.identity || {}) as Record<string, unknown>;
  const runtime = classifyBotRuntime(identity.runtime);
  const ports = { ...EMPTY_PORTS, ...((inst.ports || {}) as InstancePorts) };
  const urls = { ...(inst.urls || {}) };
  const apiPort = Number(ports.api || ports.gateway || 18789);
  const httpsPort = Number(ports.https || apiPort + 1000);
  const reserved = new Set([
    "runtime",
    "name",
    "display_name",
    "health_path",
    "default_model",
    "fallback_host",
    "api_base",
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(identity)) {
    if (!reserved.has(k)) extra[k] = v;
  }
  return {
    runtime,
    displayName: str(identity, "display_name") || str(identity, "name") || inst.slug,
    host: inst.host || "127.0.0.1",
    fallbackHost: str(identity, "fallback_host") || urls.host_fallback || "",
    ports,
    urls,
    tls: normalizeTls((inst.tls as InstanceTls) || undefined),
    gatewayToken: "",
    apiPort,
    httpsPort,
    healthPath: str(identity, "health_path"),
    apiBase: urls.api_base || str(identity, "api_base") || "https://api.openai.com/v1",
    defaultModel: str(identity, "default_model"),
    identityExtra: extra,
  };
}

export function instanceWriteBody(
  form: RuntimeFormValue,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const runtime = form.runtime;
  const name = form.displayName.trim();
  const fallbackHost = form.fallbackHost.trim();
  const identity: Record<string, unknown> = {
    ...form.identityExtra,
    runtime,
    ...(name ? { name, display_name: name } : {}),
    ...(fallbackHost ? { fallback_host: fallbackHost } : {}),
    ...(form.defaultModel.trim() ? { default_model: form.defaultModel.trim() } : {}),
  };
  const tls = normalizeTls(form.tls);
  let host = form.host.trim();
  let ports: InstancePorts = portsToPayload(form.ports);
  let urls = { ...form.urls };

  if (runtime === "hermes") {
    identity.health_path = resolveHealthPath("hermes", form.healthPath);
    ports = { api: form.apiPort, gateway: form.apiPort, https: form.httpsPort };
    urls = buildHermesInstanceUrls({
      host,
      fallbackHost,
      apiPort: form.apiPort,
      httpsPort: form.httpsPort,
    });
  } else if (runtime === "openai-like") {
    identity.health_path = resolveHealthPath("openai-like", form.healthPath);
    identity.api_base = form.apiBase.trim();
    urls = buildOpenAiLikeUrls({ apiBase: form.apiBase, fallbackHost });
    host = hostnameFromUrl(urls.api_base || form.apiBase) || host;
    ports = {};
  } else {
    identity.health_path = resolveHealthPath("openclaw", form.healthPath);
  }

  return {
    host,
    ports,
    urls,
    tls,
    identity,
    ...(form.gatewayToken.trim() ? { gateway_token: form.gatewayToken.trim() } : {}),
    ...extra,
  };
}

export function tokenFieldLabel(runtime: BotRuntimeKind): string {
  if (runtime === "openclaw") return "OpenClaw gateway token";
  if (runtime === "hermes") return "Hermes API key";
  return "API key";
}
