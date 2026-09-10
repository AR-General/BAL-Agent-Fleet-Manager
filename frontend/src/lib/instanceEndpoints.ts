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

export function attachFallbackUrls(
  urls: Record<string, string>,
  fallbackHost?: string,
): Record<string, string> {
  const host = (fallbackHost || "").trim();
  const next: Record<string, string> = { ...urls };
  for (const key of Object.keys(next)) {
    if (key.endsWith("_fallback") || key === "host_fallback") delete next[key];
  }
  if (!host) return next;
  next.host_fallback = host;
  for (const [key, value] of Object.entries(urls)) {
    if (!value || key.endsWith("_fallback") || key === "host_fallback") continue;
    if (!/^https?:/i.test(value)) continue;
    try {
      next[`${key}_fallback`] = rewriteUrlHost(value, host);
    } catch {
      // skip malformed URL
    }
  }
  return next;
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

export function buildOpenAiLikeUrls(opts: { apiBase: string; fallbackHost?: string }): Record<string, string> {
  const api_base = normalizeOpenAiApiBase(opts.apiBase);
  if (!api_base) return {};
  let root = api_base.replace(/\/v1$/i, "");
  try {
    const u = new URL(api_base);
    root = `${u.protocol}//${u.host}`;
  } catch {
    /* keep stripped root */
  }
  return attachFallbackUrls(
    {
      api_base,
      gateway_intranet: root,
      health: `${api_base}/models`,
    },
    opts.fallbackHost,
  );
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

export function deriveInstanceEndpoints(input: {
  host?: string | null;
  urls?: Record<string, string> | null;
  identity?: Record<string, unknown> | null;
}): InstanceEndpoints {
  const urls = input.urls || {};
  const fallbackHost = String(urls.host_fallback || input.identity?.fallback_host || "").trim();
  const primaryUrl = urls.api_base || urls.gateway_intranet || urls.health || (input.host ? `http://${input.host}` : "");
  const primary = primaryUrl ? endpointFromUrl(primaryUrl, "primary") : null;
  let fallbackUrl = urls.api_base_fallback || urls.gateway_intranet_fallback || "";
  if (!fallbackUrl && primaryUrl && fallbackHost) {
    try {
      fallbackUrl = rewriteUrlHost(primaryUrl, fallbackHost);
    } catch {
      fallbackUrl = "";
    }
  }
  const fallback =
    fallbackUrl && (!primary || hostnameFromUrl(fallbackUrl) !== hostnameFromUrl(primary.url))
      ? endpointFromUrl(fallbackUrl, "fallback")
      : null;
  const control_ui = urls.control_ui ? endpointFromUrl(urls.control_ui, "primary") : null;
  return { primary, fallback, control_ui };
}

export function instanceEndpoints(input: {
  host?: string | null;
  urls?: Record<string, string> | null;
  identity?: Record<string, unknown> | null;
  endpoints?: InstanceEndpoints;
}): InstanceEndpoints {
  if (input.endpoints?.primary) return input.endpoints;
  return deriveInstanceEndpoints(input);
}
