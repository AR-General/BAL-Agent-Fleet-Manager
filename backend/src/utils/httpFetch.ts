import http from "node:http";
import https from "node:https";
import { isTlsCertError } from "./tlsErrors.js";

export type FetchTlsOptions = {
  allowSelfSigned?: boolean;
  timeoutMs?: number;
};

export type FetchHealthzResult = {
  ok: boolean;
  status?: number;
  ms: number;
  url: string;
  error?: string;
  tls_warning?: string;
  tls_hint?: string;
};

function isHttps(url: string): boolean {
  return url.startsWith("https://");
}

function nodeRequest(
  url: string,
  opts: {
    allowSelfSigned: boolean;
    timeoutMs: number;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ status: number; ok: boolean; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isTls = parsed.protocol === "https:";
    const lib = isTls ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isTls ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: opts.method ?? "GET",
        headers: opts.headers,
        timeout: opts.timeoutMs,
        ...(isTls && opts.allowSelfSigned ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            body,
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Fetch compatible wrapper using Node http/https only (no undici / node:undici). */
export async function fetchWithTls(
  url: string,
  init: RequestInit & FetchTlsOptions = {},
): Promise<Response> {
  const { allowSelfSigned = false, timeoutMs = 8000, method, headers, body } = init;
  const headerMap: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      headerMap[k] = v;
    });
  } else if (headers && typeof headers === "object") {
    Object.assign(headerMap, headers as Record<string, string>);
  }
  const bodyText =
    typeof body === "string" ? body : body != null ? String(body) : undefined;
  const useInsecure = allowSelfSigned && isHttps(url);

  const result = await nodeRequest(url, {
    allowSelfSigned: useInsecure,
    timeoutMs,
    method: method ?? "GET",
    headers: headerMap,
    body: bodyText,
  });
  return new Response(result.body, {
    status: result.status,
    statusText: result.ok ? "OK" : "Error",
  });
}

export type HealthProbeOptions = FetchTlsOptions & {
  /** Absolute health URL, or base URL + path derived from runtime. */
  healthPath?: string;
};

/** Resolve health probe URL from instance urls + runtime (hermes → /health, openclaw → /healthz). */
export function resolveHealthUrl(
  urls: Record<string, string | undefined>,
  identity?: Record<string, unknown> | null,
): { url: string; path: string } {
  if (urls.health) {
    return { url: urls.health.replace(/\/$/, ""), path: new URL(urls.health).pathname };
  }
  const runtime = String(identity?.runtime || "openclaw").toLowerCase();
  const path =
    typeof identity?.health_path === "string"
      ? identity.health_path
      : runtime === "hermes"
        ? "/health"
        : "/healthz";
  const base = (urls.gateway_intranet || urls.api_base || "").replace(/\/$/, "");
  if (!base) return { url: "", path };
  // Strip trailing /v1 if present — health is on API root, not OpenAI path.
  const root = base.replace(/\/v1\/?$/, "");
  return { url: `${root}${path.startsWith("/") ? path : `/${path}`}`, path };
}

export async function fetchHealthz(
  baseUrl: string,
  opts: HealthProbeOptions = {},
): Promise<FetchHealthzResult> {
  const path = opts.healthPath ?? "/healthz";
  const url = baseUrl.includes("://") && (baseUrl.endsWith(path) || /\/healthz?$/.test(baseUrl))
    ? baseUrl.replace(/\/$/, "")
    : `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const start = Date.now();
  const allowSelfSigned = opts.allowSelfSigned ?? false;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const tlsWarning =
    allowSelfSigned && isHttps(url)
      ? "Self-signed or untrusted TLS certificate accepted for this request."
      : undefined;

  try {
    const result = await nodeRequest(url, {
      allowSelfSigned: allowSelfSigned && isHttps(url),
      timeoutMs,
    });
    const ms = Date.now() - start;
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        ms,
        url,
        error: `HTTP ${result.status}`,
      };
    }
    return { ok: true, status: result.status, ms, url, tls_warning: tlsWarning };
  } catch (e) {
    const ms = Date.now() - start;
    const message = e instanceof Error ? e.message : String(e);
    const hint =
      !allowSelfSigned && isHttps(url) && isTlsCertError(e)
        ? "Enable “Allow self-signed TLS” on the instance to probe HTTPS gateways with auto-generated certificates."
        : undefined;
    return { ok: false, ms, url, error: message, tls_hint: hint };
  }
}
