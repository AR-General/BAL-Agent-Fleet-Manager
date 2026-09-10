import {
  HTTP_PLAINTEXT_WARNING,
  instanceEndpoints,
  type EndpointSummary,
} from "../../lib/instanceEndpoints";
import type { DbInstance } from "../../types";

function SchemeBadge({ endpoint, compact }: { endpoint: EndpointSummary; compact?: boolean }) {
  if (endpoint.tls) {
    return (
      <span className="badge ok" title="TLS (HTTPS)">
        TLS
      </span>
    );
  }
  if (endpoint.scheme === "http") {
    return (
      <span className="badge warn" title={endpoint.http_warning || HTTP_PLAINTEXT_WARNING}>
        {compact ? "HTTP" : "HTTP — no TLS"}
      </span>
    );
  }
  return <span className="badge">—</span>;
}

function EndpointLine({
  label,
  endpoint,
}: {
  label: string;
  endpoint: EndpointSummary;
}) {
  return (
    <div className="endpoint-row">
      <span className="endpoint-role">{label}</span>
      <a href={endpoint.url} target="_blank" rel="noreferrer" className="endpoint-host">
        {endpoint.host}
      </a>
      <SchemeBadge endpoint={endpoint} />
    </div>
  );
}

export function EndpointStack({ inst }: { inst: DbInstance }) {
  const endpoints = instanceEndpoints(inst);
  if (!endpoints.primary && !inst.host) {
    return <span className="muted">—</span>;
  }
  return (
    <div className="endpoint-stack">
      {endpoints.primary && <EndpointLine label="primary" endpoint={endpoints.primary} />}
      {endpoints.fallback && <EndpointLine label="fallback" endpoint={endpoints.fallback} />}
      {endpoints.control_ui && <EndpointLine label="UI" endpoint={endpoints.control_ui} />}
      {!endpoints.primary && inst.host && <div className="muted">{inst.host}</div>}
      {endpoints.primary?.scheme === "http" && (
        <div className="endpoint-http-warn" title={HTTP_PLAINTEXT_WARNING}>
          API is plaintext HTTP
        </div>
      )}
      {inst.health?.used_fallback && (
        <div className="endpoint-http-warn">Health via fallback</div>
      )}
    </div>
  );
}

export function UrlSchemeBadge({ url }: { url: string }) {
  const scheme = /^https:/i.test(url) ? "https" : /^http:/i.test(url) ? "http" : "other";
  if (scheme === "https") {
    return (
      <span className="badge ok" title="TLS (HTTPS)">
        TLS
      </span>
    );
  }
  if (scheme === "http") {
    return (
      <span className="badge warn" title={HTTP_PLAINTEXT_WARNING}>
        HTTP — no TLS
      </span>
    );
  }
  return null;
}
