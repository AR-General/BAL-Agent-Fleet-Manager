import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { InstancePorts } from "../../types/ports";
import { EMPTY_PORTS, portsToPayload } from "../../types/ports";
import type { InstanceTls } from "../../types/tls";
import { normalizeTls } from "../../types/tls";
import { TlsConfigPanel } from "./TlsConfigPanel";
import { UrlSchemeBadge } from "./EndpointStack";
import { attachFallbackUrls } from "../../lib/instanceEndpoints";

type LiveCheck = {
  ok: boolean;
  ms: number;
  url: string;
  status?: number;
  error?: string;
  tls_warning?: string;
  tls_hint?: string;
};

type Props = {
  host: string;
  ports: InstancePorts;
  urls: Record<string, string>;
  tls: InstanceTls;
  onHostChange: (host: string) => void;
  onPortsChange: (ports: InstancePorts) => void;
  onUrlsChange: (urls: Record<string, string>) => void;
  onTlsChange: (tls: InstanceTls) => void;
  /** When set, POST /health/:slug/ping updates instance health */
  pingSlug?: string;
};

const SERVICE_PORTS: { key: keyof InstancePorts; label: string; hint?: string }[] = [
  { key: "https", label: "HTTPS / Control UI" },
  { key: "bridge_https", label: "Bridge HTTPS" },
  { key: "bridge", label: "Bridge (HTTP, internal)" },
  { key: "signal", label: "Signal REST" },
  { key: "twilio", label: "Twilio bridge" },
  { key: "ollama", label: "Ollama", hint: "optional" },
];

function defaultProbeUrl(host: string, ports: InstancePorts, tls: InstanceTls): string {
  const h = host.replace(/\/$/, "");
  const normalized = normalizeTls(tls);
  if (normalized.gateway_https && ports.https) {
    return `https://${h}:${ports.https}`;
  }
  if (ports.gateway) {
    return `http://${h}:${ports.gateway}`;
  }
  return "";
}

export function PortConfigEditor({
  host,
  ports,
  urls,
  tls,
  onHostChange,
  onPortsChange,
  onUrlsChange,
  onTlsChange,
  pingSlug,
}: Props) {
  const [presetSlot, setPresetSlot] = useState(String(ports.slot ?? 0));
  const [showPreset, setShowPreset] = useState(false);
  const [probeUrl, setProbeUrl] = useState(
    urls.gateway_intranet || defaultProbeUrl(host, ports, tls),
  );
  const [probeResult, setProbeResult] = useState<LiveCheck | null>(null);
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([]);
  const [pingStatus, setPingStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!probeUrl && host && (ports.gateway || ports.https)) {
      setProbeUrl(defaultProbeUrl(host, ports, tls));
    }
  }, [host, ports.gateway, ports.https, tls.gateway_https]);

  async function applyPreset() {
    setBusy(true);
    try {
      const slot = Number(presetSlot);
      const r = await api<{
        ports: InstancePorts;
        urls: Record<string, string>;
        allowed_origins?: string[];
      }>(`/instances/port-presets/${slot}?host=${encodeURIComponent(host)}`);
      onPortsChange(r.ports);
      onUrlsChange(r.urls);
      setAllowedOrigins(r.allowed_origins || []);
      setProbeUrl(r.urls.gateway_intranet || defaultProbeUrl(host, r.ports, tls));
    } finally {
      setBusy(false);
    }
  }

  async function syncFromGateway() {
    const gw = Number(ports.gateway);
    if (!gw || gw < 1) return;
    setBusy(true);
    try {
      const r = await api<{ ports: InstancePorts }>("/instances/derive-ports", {
        method: "POST",
        body: JSON.stringify({ gateway: gw, slot_fallback: ports.slot ?? 0 }),
      });
      onPortsChange(r.ports);
    } finally {
      setBusy(false);
    }
  }

  async function rebuildUrls() {
    setBusy(true);
    try {
      const r = await api<{ urls: Record<string, string>; allowed_origins?: string[] }>(
        "/instances/compute-urls",
        {
          method: "POST",
          body: JSON.stringify({
            host,
            ports: portsToPayload(ports),
            tls: normalizeTls(tls),
            fallback_host: urls.host_fallback || undefined,
          }),
        },
      );
      onUrlsChange(r.urls);
      setAllowedOrigins(r.allowed_origins || []);
      setProbeUrl(r.urls.gateway_intranet || "");
    } finally {
      setBusy(false);
    }
  }

  async function testProbe() {
    const url = probeUrl.trim();
    if (!url) return;
    setBusy(true);
    setPingStatus(null);
    try {
      const normalized = normalizeTls(tls);
      const r = await api<LiveCheck>("/health/probe", {
        method: "POST",
        body: JSON.stringify({
          url,
          allow_self_signed: normalized.allow_self_signed,
        }),
      });
      setProbeResult(r);
    } finally {
      setBusy(false);
    }
  }

  async function pingInstance() {
    if (pingSlug) {
      setBusy(true);
      setPingStatus(null);
      try {
        const r = await api<{
          ping: LiveCheck & { status: string };
          tls_warning?: string;
        }>(`/health/${pingSlug}/ping`, { method: "POST" });
        setProbeResult({
          ok: r.ping.ok,
          ms: r.ping.ms,
          url: r.ping.url,
          error: r.ping.error,
          tls_warning: r.tls_warning ?? r.ping.tls_warning,
          tls_hint: r.ping.tls_hint,
        });
        setPingStatus(r.ping.status);
      } finally {
        setBusy(false);
      }
      return;
    }
    await testProbe();
  }

  function setPort(key: keyof InstancePorts, value: string) {
    const n = value === "" ? undefined : Number(value);
    const next = { ...ports, [key]: n };
    if (key === "https" && n != null && (ports.bridge_https == null || ports.bridge_https === (ports.https ?? 0) + 1)) {
      next.bridge_https = n + 1;
    }
    onPortsChange(next);
  }

  function onGatewayChange(value: string) {
    const gw = value === "" ? undefined : Number(value);
    onPortsChange({ ...ports, gateway: gw });
    if (host && gw && !normalizeTls(tls).gateway_https) {
      setProbeUrl(`http://${host.replace(/\/$/, "")}:${gw}`);
    }
  }

  function onTlsChangeWithRebuild(next: InstanceTls) {
    onTlsChange(next);
    const normalized = normalizeTls(next);
    if (host && ports.https && normalized.gateway_https) {
      setProbeUrl(`https://${host.replace(/\/$/, "")}:${ports.https}`);
    }
  }

  return (
    <div className="port-config">
      <h3>Network & ports</h3>
      <p className="muted">
        Health checks call <code>/healthz</code> on <code>gateway_intranet</code>. With nginx TLS, set HTTPS
        port and enable self-signed if using <code>scripts/gen-openclaw-ssl.sh</code>.
      </p>

      <div className="form-grid">
        <label>
          Host
          <input value={host} onChange={(e) => onHostChange(e.target.value)} placeholder="127.0.0.1" />
        </label>
        <label>
          Fallback host
          <input
            value={urls.host_fallback || ""}
            onChange={(e) => onUrlsChange(attachFallbackUrls(urls, e.target.value.trim()))}
            placeholder="10.0.0.2"
          />
        </label>
        <label>
          Gateway port (internal HTTP) *
          <input
            type="number"
            min={1}
            max={65535}
            required
            value={ports.gateway ?? ""}
            onChange={(e) => onGatewayChange(e.target.value)}
            placeholder="18889"
          />
        </label>
      </div>

      <TlsConfigPanel tls={tls} onChange={onTlsChangeWithRebuild} />

      <div className="toolbar" style={{ marginTop: "0.5rem" }}>
        <button type="button" className="secondary" onClick={syncFromGateway} disabled={busy || !ports.gateway}>
          Sync standard offsets from gateway
        </button>
        <button type="button" className="secondary" onClick={rebuildUrls} disabled={busy || !host}>
          Rebuild URLs
        </button>
      </div>

      <details style={{ marginTop: "0.75rem" }} open={showPreset} onToggle={(e) => setShowPreset(e.currentTarget.open)}>
        <summary className="muted" style={{ cursor: "pointer" }}>
          Fleet slot preset (optional — instances using OC_PORT_SLOT)
        </summary>
        <div className="toolbar" style={{ marginTop: "0.5rem" }}>
          <select value={presetSlot} onChange={(e) => setPresetSlot(e.target.value)} aria-label="Fleet slot">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                Slot {n} (gateway {18789 + n * 100}, HTTPS {8443 + n * 100})
              </option>
            ))}
          </select>
          <button type="button" className="secondary" onClick={applyPreset} disabled={busy}>
            Apply preset
          </button>
        </div>
      </details>

      <h4 style={{ marginTop: "1rem" }}>Service ports</h4>
      <div className="form-grid">
        {SERVICE_PORTS.map(({ key, label, hint }) => (
          <label key={key}>
            {label}
            {hint && <span className="muted"> ({hint})</span>}
            <input
              type="number"
              min={1}
              max={65535}
              value={ports[key] ?? ""}
              onChange={(e) => setPort(key, e.target.value)}
              placeholder={String(EMPTY_PORTS[key] ?? "")}
            />
          </label>
        ))}
      </div>

      {allowedOrigins.length > 0 && (
        <>
          <h4 style={{ marginTop: "1.25rem" }}>Gateway allowedOrigins</h4>
          <p className="muted">
            Copy into <code>config/openclaw/openclaw.json</code> →{" "}
            <code>gateway.controlUi.allowedOrigins</code>, or run{" "}
            <code>./scripts/configure-from-env.sh</code> on the instance host.
          </p>
          <pre className="code" style={{ fontSize: "0.8rem", maxHeight: 160, overflow: "auto" }}>
            {JSON.stringify(allowedOrigins, null, 2)}
          </pre>
        </>
      )}

      <h4 style={{ marginTop: "1.25rem" }}>URLs</h4>
      {Object.keys(urls).length === 0 ? (
        <p className="muted">No URLs yet — click Rebuild URLs after setting host and ports.</p>
      ) : (
        <table className="table">
          <tbody>
            {Object.entries(urls).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>
                  <input
                    value={v}
                    onChange={(e) => onUrlsChange({ ...urls, [k]: e.target.value })}
                    style={{ fontSize: "0.85rem", width: "100%" }}
                  />
                </td>
                <td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <UrlSchemeBadge url={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 style={{ marginTop: "1.25rem" }}>Connection test</h4>
      <div className="toolbar">
        <input
          style={{ flex: 1, minWidth: 200 }}
          value={probeUrl}
          onChange={(e) => setProbeUrl(e.target.value)}
          placeholder="https://host:8543 — probes /healthz"
        />
        <button type="button" className="secondary" onClick={testProbe} disabled={busy || !probeUrl.trim()}>
          Test URL
        </button>
        {pingSlug ? (
          <button type="button" onClick={pingInstance} disabled={busy}>
            Ping & update health
          </button>
        ) : (
          <button type="button" onClick={pingInstance} disabled={busy || !probeUrl.trim()}>
            Test URL
          </button>
        )}
      </div>

      {probeResult && (
        <div className="card" style={{ marginTop: "0.75rem" }}>
          <span className={`badge ${probeResult.ok ? "ok" : "bad"}`}>
            {probeResult.ok ? "OK" : "Failed"} — {probeResult.ms}ms
          </span>
          <div className="muted" style={{ marginTop: "0.35rem" }}>
            {probeResult.url}
          </div>
          {probeResult.tls_warning && (
            <div className="alert-warn" style={{ marginTop: "0.5rem" }}>
              {probeResult.tls_warning}
            </div>
          )}
          {probeResult.tls_hint && (
            <div className="alert-warn" style={{ marginTop: "0.5rem" }}>
              <strong>Tip:</strong> {probeResult.tls_hint}
            </div>
          )}
          {probeResult.error && <p className="badge bad">{probeResult.error}</p>}
          {pingStatus && (
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              Instance health: <strong>{pingStatus}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
