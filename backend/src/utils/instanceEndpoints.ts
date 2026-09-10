/** Primary + fallback instance URLs, TLS scheme, and HTTP plaintext warnings. */

export const HTTP_PLAINTEXT_WARNING =
  "Unencrypted HTTP — this endpoint is not TLS-protected. Prefer HTTPS; HTTP is only acceptable on a trusted private network.";

export type UrlScheme = "https" | "http" | "other";
export type EndpointRole = "primary" | "fallback";

export type EndpointSummary = {
  role: EndpointRole;
  host: string;
  url: string;
  scheme: UrlScheme;
  tls: boolean;
  http_warning?: string;
};

export type InstanceEndpoints = {
  primary: EndpointSummary | null;
  fallback: EndpointSummary | null;
  control_ui: EndpointSummary | null;
};

const FALLBACK_META_KEYS = new Set(["host_fallback"]);

export function urlScheme(url: string): UrlScheme {
  if (/^https:/i.test(url)) return "https";
  if (/^http:/i.test(url)) return "http";
  return "other";
}

export function httpWarningForUrl(url: string): string | undefined {
  return urlScheme(url) === "http" ? HTTP_PLAINTEXT_WARNING : undefined;
}

export function hostFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function rewriteUrlHost(url: string, host: string): string {
  const u = new URL(url);
  const port = u.port;
  u.hostname = host;
  if (port) u.port = port;
  const href = u.href;
  return href.endsWith("/") && !url.endsWith("/") ? href.slice(0, -1) : href;
}

export function instanceFallbackHost(input: {
  urls?: Record<string, string | undefined> | null;
  identity?: Record<string, unknown> | null;
}): string {
  const fromUrls = String(input.urls?.host_fallback || "").trim();
  if (fromUrls) return fromUrls;
  const fromIdentity = input.identity?.fallback_host;
  return typeof fromIdentity === "string" ? fromIdentity.trim() : "";
}

export function attachFallbackUrls(
  urls: Record<string, string>,
  fallbackHost?: string,
): Record<string, string> {
  const host = (fallbackHost || "").trim();
  if (!host) return { ...urls };
  const out: Record<string, string> = { ...urls, host_fallback: host };
  for (const [key, value] of Object.entries(urls)) {
    if (!value || FALLBACK_META_KEYS.has(key) || key.endsWith("_fallback")) continue;
    if (!/^https?:/i.test(value)) continue;
    try {
      out[`${key}_fallback`] = rewriteUrlHost(value, host);
    } catch {
      // skip malformed URL
    }
  }
  return out;
}

export function resolveUrlCandidates(
  urls: Record<string, string | undefined>,
  key: string,
  fallbackHost?: string,
): string[] {
  const primary = String(urls[key] || "").trim();
  const explicit = String(urls[`${key}_fallback`] || "").trim();
  const derived =
    primary && fallbackHost
      ? (() => {
          try {
            return rewriteUrlHost(primary, fallbackHost);
          } catch {
            return "";
          }
        })()
      : "";
  return [...new Set([primary, explicit, derived].filter(Boolean))];
}

function endpointFromUrl(url: string, role: EndpointRole): EndpointSummary {
  const scheme = urlScheme(url);
  return {
    role,
    host: hostFromUrl(url),
    url,
    scheme,
    tls: scheme === "https",
    http_warning: httpWarningForUrl(url),
  };
}

function pickPrimaryUrl(urls: Record<string, string>, host?: string | null): string {
  return (
    urls.api_base ||
    urls.gateway_intranet ||
    urls.health ||
    (host ? `http://${host}` : "")
  );
}

export function summarizeInstanceEndpoints(input: {
  host?: string | null;
  urls?: Record<string, string> | null;
  identity?: Record<string, unknown> | null;
}): InstanceEndpoints {
  const urls = (input.urls || {}) as Record<string, string>;
  const fallbackHost = instanceFallbackHost(input);
  const primaryUrl = pickPrimaryUrl(urls, input.host);
  const primary = primaryUrl ? endpointFromUrl(primaryUrl, "primary") : null;

  const fallbackCandidates = resolveUrlCandidates(
    { ...urls, api_base: urls.api_base || urls.gateway_intranet || primaryUrl },
    urls.api_base ? "api_base" : urls.gateway_intranet ? "gateway_intranet" : "health",
    fallbackHost,
  );
  const fallbackUrl = fallbackCandidates.find((u) => primary && hostnameFromUrl(u) !== hostnameFromUrl(primary.url));
  const fallback = fallbackUrl ? endpointFromUrl(fallbackUrl, "fallback") : null;

  const controlPrimary = urls.control_ui ? endpointFromUrl(urls.control_ui, "primary") : null;
  return {
    primary,
    fallback,
    control_ui: controlPrimary,
  };
}

export function buildHermesInstanceUrls(opts: {
  host: string;
  fallbackHost?: string;
  apiPort: number;
  httpsPort: number;
}): Record<string, string> {
  const host = opts.host.trim();
  const base: Record<string, string> = {
    gateway_intranet: `http://${host}:${opts.apiPort}`,
    api_base: `http://${host}:${opts.apiPort}`,
    health: `http://${host}:${opts.apiPort}/health`,
    control_ui: `https://${host}:${opts.httpsPort}`,
  };
  return attachFallbackUrls(base, opts.fallbackHost);
}

export function normalizeOpenAiApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

export function buildOpenAiLikeUrls(opts: {
  apiBase: string;
  fallbackHost?: string;
}): Record<string, string> {
  const api_base = normalizeOpenAiApiBase(opts.apiBase);
  if (!api_base) return {};
  let root = api_base.replace(/\/v1$/i, "");
  try {
    const u = new URL(api_base);
    root = `${u.protocol}//${u.host}`;
  } catch {
    /* keep stripped root */
  }
  const base: Record<string, string> = {
    api_base,
    gateway_intranet: root,
    health: `${api_base}/models`,
  };
  return attachFallbackUrls(base, opts.fallbackHost);
}

export function resolveApiBaseCandidates(input: {
  urls?: Record<string, string | undefined> | null;
  identity?: Record<string, unknown> | null;
}): string[] {
  const urls = (input.urls || {}) as Record<string, string>;
  const fallbackHost = instanceFallbackHost(input);
  const key = urls.api_base ? "api_base" : "gateway_intranet";
  return resolveUrlCandidates(urls, key, fallbackHost).map((u) =>
    u.replace(/\/v1\/?$/, "").replace(/\/$/, ""),
  );
}

export function resolveHealthUrlCandidates(
  urls: Record<string, string | undefined>,
  identity?: Record<string, unknown> | null,
): Array<{ url: string; path: string; role: EndpointRole }> {
  const fallbackHost = instanceFallbackHost({ urls, identity });
  const runtime = String(identity?.runtime || "openclaw").toLowerCase();
  const path =
    typeof identity?.health_path === "string"
      ? identity.health_path
      : runtime === "hermes"
        ? "/health"
        : "/healthz";

  const fromHealth = resolveUrlCandidates(urls, "health", fallbackHost);
  if (fromHealth.length) {
    return fromHealth.map((url, i) => ({
      url: url.replace(/\/$/, ""),
      path: safePath(url, path),
      role: i === 0 ? "primary" : "fallback",
    }));
  }

  const bases = resolveUrlCandidates(
    urls,
    urls.gateway_intranet ? "gateway_intranet" : "api_base",
    fallbackHost,
  );
  return bases.map((base, i) => {
    const root = base.replace(/\/$/, "").replace(/\/v1\/?$/, "");
    const url = `${root}${path.startsWith("/") ? path : `/${path}`}`;
    return { url, path, role: i === 0 ? "primary" : "fallback" };
  });
}

function safePath(url: string, fallbackPath: string): string {
  try {
    return new URL(url).pathname || fallbackPath;
  } catch {
    return fallbackPath;
  }
}

export function isRetryableNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error && err.name === "AbortError") return false;
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  const cause =
    err instanceof Error && err.cause && typeof err.cause === "object"
      ? (err.cause as { code?: string })
      : undefined;
  const causeCode = cause?.code ? String(cause.code) : "";
  const msg = err instanceof Error ? err.message : String(err);
  const combined = `${msg} ${code} ${causeCode}`.toLowerCase();
  return /econnrefused|etimedout|enotfound|ehostunreach|enetunreach|econnreset|eai_again|fetch failed|network|socket hang up|request timed out|connect timeout/.test(
    combined,
  );
}
