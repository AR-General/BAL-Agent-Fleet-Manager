import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { DbInstance, FleetEvent, HealthLog } from "../types";
import { PageHeader } from "../components/common/PageHeader";
import { Tabs } from "../components/common/Tabs";
import { Modal } from "../components/common/Modal";
import { HealthBadge } from "../components/common/HealthBadge";
import { instanceDisplayName, formatTs, parseJsonField } from "../utils/instance";
import { InstanceRuntimeFields } from "../components/instances/InstanceRuntimeFields";
import { ChannelConfigEditor } from "../components/instances/ChannelConfigEditor";
import { InstanceProfilePanel } from "../components/instances/InstanceProfilePanel";
import { AgentAvatarVoiceEditor } from "../components/agents/AgentAvatarVoiceEditor";
import { normalizeTls, tlsSelfSignedWarning, type InstanceTls } from "../types/tls";
import { UrlSchemeBadge } from "../components/instances/EndpointStack";
import { HTTP_PLAINTEXT_WARNING } from "../lib/instanceEndpoints";
import { instanceWriteBody, runtimeFormFromInstance, type RuntimeFormValue } from "../lib/instanceRuntimeForm";
import { classifyBotRuntime, RUNTIME_LABELS } from "../lib/botRuntime";

type TokenRow = {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type LiveCheck = {
  ok: boolean;
  ms: number;
  url: string;
  status?: number;
  error?: string;
  tls_warning?: string;
  tls_hint?: string;
  http_warning?: string;
  used_fallback?: boolean;
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "config", label: "Configuration" },
  { id: "avatar", label: "Avatar & voice" },
  { id: "channels", label: "Channels" },
  { id: "profile", label: "Profile pictures" },
  { id: "health", label: "Health" },
  { id: "events", label: "Events" },
  { id: "tokens", label: "API tokens" },
];

export function InstanceDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [inst, setInst] = useState<DbInstance | null>(null);
  const [live, setLive] = useState<LiveCheck | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenLabel, setTokenLabel] = useState("skill");

  const [editStatus, setEditStatus] = useState("");
  const [runtimeForm, setRuntimeForm] = useState<RuntimeFormValue | null>(null);
  const [tlsWarning, setTlsWarning] = useState<string | undefined>();
  const [httpWarning, setHttpWarning] = useState<string | undefined>();
  const [editChannels, setEditChannels] = useState("{}");
  const [pinging, setPinging] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setError("");
    const row = await api<DbInstance>(`/instances/${slug}`);
    setInst(row);
    setEditStatus(row.status || "registered");
    setRuntimeForm(runtimeFormFromInstance(row));
    setEditChannels(JSON.stringify(row.channels || {}, null, 2));

    const [tok, healthDetail] = await Promise.all([
      api<{ tokens: TokenRow[] }>(`/instances/${slug}/tokens`),
      api<{
        instance: DbInstance;
        live_check: LiveCheck | null;
        tls_warning?: string;
        http_warning?: string;
      }>(`/health/${slug}`).catch(() => null),
    ]);
    setTokens(tok.tokens.filter((t) => !t.revokedAt));
    if (healthDetail) {
      setInst(healthDetail.instance);
      setLive(healthDetail.live_check);
      setTlsWarning(
        healthDetail.tls_warning ??
          tlsSelfSignedWarning(normalizeTls((healthDetail.instance.tls as InstanceTls) || undefined)),
      );
      setHttpWarning(
        healthDetail.http_warning ??
          healthDetail.live_check?.http_warning ??
          healthDetail.instance.health?.http_warning ??
          undefined,
      );
    } else {
      setTlsWarning(tlsSelfSignedWarning(normalizeTls((row.tls as InstanceTls) || undefined)));
      setHttpWarning(row.health?.http_warning ?? undefined);
    }
  }, [slug]);

  const loadHealth = useCallback(async () => {
    if (!slug) return;
    const h = await api<{ logs: HealthLog[] }>(`/health/${slug}/history`);
    setLogs(h.logs);
  }, [slug]);

  const loadEvents = useCallback(async () => {
    if (!slug) return;
    const e = await api<{ events: FleetEvent[] }>(`/instances/${slug}/events`);
    setEvents(e.events);
  }, [slug]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [load]);

  useEffect(() => {
    if (tab === "health") loadHealth().catch(() => {});
    if (tab === "events") loadEvents().catch(() => {});
  }, [tab, loadHealth, loadEvents]);

  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    if (!slug) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api<DbInstance>(`/instances/${slug}`, {
        method: "PUT",
        body: JSON.stringify({
          status: editStatus,
          channels: parseJsonField(editChannels),
          ...(runtimeForm ? instanceWriteBody(runtimeForm) : {}),
        }),
      });
      setInst(updated);
      setRuntimeForm(runtimeFormFromInstance(updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function createToken(e: FormEvent) {
    e.preventDefault();
    if (!slug) return;
    const res = await api<{ token: string; entry: TokenRow }>(`/instances/${slug}/tokens`, {
      method: "POST",
      body: JSON.stringify({ label: tokenLabel }),
    });
    setNewToken(res.token);
    setTokens((t) => [...t, res.entry]);
  }

  async function revokeToken(tokenId: string) {
    if (!slug || !confirm("Revoke this token?")) return;
    await api(`/instances/${slug}/tokens/${tokenId}`, { method: "DELETE" });
    setTokens((t) => t.filter((x) => x.id !== tokenId));
  }

  async function onDelete() {
    if (!slug || !confirm(`Delete instance "${slug}"?`)) return;
    await api(`/instances/${slug}`, { method: "DELETE" });
    navigate("/instances");
  }

  async function pingNow() {
    if (!slug) return;
    setPinging(true);
    try {
      const r = await api<{
        ping: LiveCheck & { status: string };
        instance: DbInstance;
        tls_warning?: string;
      }>(`/health/${slug}/ping`, { method: "POST" });
      setLive(r.ping);
      setInst(r.instance);
      setTlsWarning(r.tls_warning ?? r.ping.tls_warning);
      setHttpWarning(r.ping.http_warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ping failed");
    } finally {
      setPinging(false);
    }
  }

  if (!inst) return <p className="muted">Loading…</p>;

  const ports = inst.ports as Record<string, number | undefined>;
  const urls = inst.urls || {};

  return (
    <>
      <PageHeader
        title={instanceDisplayName(inst)}
        subtitle={`${inst.slug} · ${RUNTIME_LABELS[classifyBotRuntime(inst.identity?.runtime)]}`}
        backTo="/instances"
        actions={
          <>
            <button type="button" className="secondary" onClick={pingNow} disabled={pinging}>
              {pinging ? "Pinging…" : "Ping test"}
            </button>
            <button type="button" className="secondary" onClick={() => load()}>
              Refresh
            </button>
            <button type="button" className="danger" onClick={onDelete}>
              Delete
            </button>
          </>
        }
      />

      {error && <p className="badge bad" style={{ marginBottom: "1rem" }}>{error}</p>}

      {tlsWarning && (
        <div className="alert-warn" style={{ marginBottom: "1rem" }} role="status">
          <strong>TLS notice</strong>
          <p>{tlsWarning}</p>
        </div>
      )}
      {(httpWarning || live?.http_warning) && (
        <div className="alert-warn" style={{ marginBottom: "1rem" }} role="status">
          <strong>HTTP — no TLS</strong>
          <p>{httpWarning || live?.http_warning || HTTP_PLAINTEXT_WARNING}</p>
        </div>
      )}
      {live?.used_fallback && (
        <div className="alert-warn" style={{ marginBottom: "1rem" }} role="status">
          <strong>Fallback endpoint</strong>
          <p>Primary host did not respond; live probe succeeded on the secondary URL.</p>
        </div>
      )}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <>
          <div className="stat-row">
            <div className="stat-card">
              <span className="muted">Health</span>
              <HealthBadge status={inst.health?.status} />
            </div>
            <div className="stat-card">
              <span className="muted">Live probe</span>
              <strong>{live ? (live.ok ? "OK" : "Fail") : "—"}</strong>
              {live && <div className="muted">{live.ms}ms</div>}
            </div>
            <div className="stat-card">
              <span className="muted">Status</span>
              <strong>{inst.status || "—"}</strong>
            </div>
            <div className="stat-card">
              <span className="muted">Last seen</span>
              <strong style={{ fontSize: "0.95rem" }}>{formatTs(inst.lastSeen)}</strong>
            </div>
          </div>
          <div className="split">
            <div className="card">
              <h3>Ports</h3>
              <pre className="code">{JSON.stringify(ports, null, 2)}</pre>
            </div>
            <div className="card">
              <h3>URLs</h3>
              <table className="table">
                <tbody>
                  {Object.entries(urls).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>
                        <a href={v} target="_blank" rel="noreferrer">
                          {v}
                        </a>{" "}
                        <UrlSchemeBadge url={v} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {live?.tls_warning && (
            <div className="alert-warn" style={{ marginTop: "1rem" }}>
              {live.tls_warning}
            </div>
          )}
          {live?.tls_hint && (
            <div className="alert-warn" style={{ marginTop: "1rem" }}>
              <strong>Tip:</strong> {live.tls_hint}
            </div>
          )}
          {live?.error && (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h3>Probe error</h3>
              <p className="badge bad">{live.error}</p>
            </div>
          )}
        </>
      )}

      {tab === "config" && runtimeForm && (
        <form onSubmit={saveConfig} className="card">
          <div className="form-grid" style={{ marginBottom: "1rem" }}>
            <label>
              Status
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="registered">registered</option>
                <option value="active">active</option>
                <option value="maintenance">maintenance</option>
                <option value="offline">offline</option>
              </select>
            </label>
            <label className="full">
              Channels JSON (instance registry)
              <textarea rows={4} value={editChannels} onChange={(e) => setEditChannels(e.target.value)} />
            </label>
          </div>
          <InstanceRuntimeFields
            value={runtimeForm}
            onChange={setRuntimeForm}
            pingSlug={slug}
            tokenPlaceholder={
              inst?.has_gateway_token
                ? "Leave blank to keep the stored key"
                : "Required for portal chat relay to this agent"
            }
          />
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
            {inst?.has_gateway_token
              ? "A token/API key is already stored (encrypted)."
              : "No API key stored yet."}
          </p>
          <button type="submit" disabled={saving} style={{ marginTop: "1rem" }}>
            {saving ? "Saving…" : "Save configuration"}
          </button>
        </form>
      )}

      {tab === "avatar" && slug && <AgentAvatarVoiceEditor slug={slug} />}

      {tab === "channels" && slug && (
        <ChannelConfigEditor
          slug={slug}
          onSaved={(blob) => {
            if (inst) setInst({ ...inst, channels: blob });
          }}
        />
      )}

      {tab === "profile" && slug && <InstanceProfilePanel slug={slug} />}

      {tab === "health" && (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th>Response</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{formatTs(l.ts)}</td>
                <td>
                  <HealthBadge status={l.status} />
                </td>
                <td>{l.responseTimeMs != null ? `${l.responseTimeMs}ms` : "—"}</td>
                <td className="muted">{l.error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "events" && (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <td>{formatTs(ev.createdAt)}</td>
                <td>{ev.eventType}</td>
                <td>
                  <pre className="code" style={{ margin: 0 }}>
                    {JSON.stringify(ev.data, null, 2)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "tokens" && (
        <>
          <form onSubmit={createToken} className="toolbar">
            <input
              value={tokenLabel}
              onChange={(e) => setTokenLabel(e.target.value)}
              placeholder="Token label"
              style={{ maxWidth: 200 }}
            />
            <button type="submit">Generate token</button>
          </form>
          {newToken && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <p>
                <strong>Copy now</strong> — shown once:
              </p>
              <pre className="code">{newToken}</pre>
              <p className="muted">Set as OP_CONTROLLER_API_KEY on the instance.</p>
            </div>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Prefix</th>
                <th>Created</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.label}</td>
                  <td className="muted">{t.tokenPrefix}</td>
                  <td>{formatTs(t.createdAt)}</td>
                  <td>{formatTs(t.lastUsedAt)}</td>
                  <td>
                    <button type="button" className="danger" onClick={() => revokeToken(t.id)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {newToken && tab !== "tokens" && (
        <Modal open onClose={() => setNewToken(null)} title="API token created">
          <pre className="code">{newToken}</pre>
        </Modal>
      )}
    </>
  );
}
