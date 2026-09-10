import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { InstanceProfileAvatar } from "../components/instances/InstanceProfileAvatar";
import { usePortalMode } from "../stores/portalMode";
import type { DbInstance } from "../types";
import { type InstancePorts } from "../types/ports";
import { normalizeTls, tlsSelfSignedWarning, type InstanceTls } from "../types/tls";
import { PageHeader } from "../components/common/PageHeader";
import { Modal } from "../components/common/Modal";
import { HealthBadge } from "../components/common/HealthBadge";
import { EmptyState } from "../components/common/EmptyState";
import { EndpointStack } from "../components/instances/EndpointStack";
import { InstanceRuntimeFields } from "../components/instances/InstanceRuntimeFields";
import { instanceDisplayName, formatTs } from "../utils/instance";
import { classifyBotRuntime, RUNTIME_LABELS } from "../lib/botRuntime";
import { emptyRuntimeForm, instanceWriteBody, type RuntimeFormValue } from "../lib/instanceRuntimeForm";

type ProfilePreviews = Record<string, { image_id: string; image_type: string } | null>;

export function InstancesPage() {
  const portalMode = usePortalMode((s) => s.mode);
  const [items, setItems] = useState<DbInstance[]>([]);
  const [previews, setPreviews] = useState<ProfilePreviews>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState("registered");
  const [runtimeForm, setRuntimeForm] = useState<RuntimeFormValue>(emptyRuntimeForm);

  const load = useCallback(() => {
    setLoading(true);
    const visibility = portalMode === "demo" ? "public" : "internal";
    Promise.all([
      api<{ instances: DbInstance[] }>("/instances"),
      api<{ previews: ProfilePreviews }>(`/instances/profile-previews?visibility=${visibility}`),
    ])
      .then(([inst, prev]) => {
        setItems(inst.instances);
        setPreviews(prev.previews);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [portalMode]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!createOpen || runtimeForm.runtime !== "openclaw") return;
    api<{ ports: InstancePorts; urls: Record<string, string> }>(
      `/instances/port-presets/0?host=${encodeURIComponent(runtimeForm.host)}`,
    ).then((r) => setRuntimeForm((f) => ({ ...f, ports: r.ports, urls: r.urls })));
  }, [createOpen, runtimeForm.runtime]);

  const filtered = useMemo(() => {
    return items.filter((inst) => {
      const name = instanceDisplayName(inst).toLowerCase();
      const q = search.toLowerCase();
      if (q && !inst.slug.toLowerCase().includes(q) && !name.includes(q)) return false;
      const h = inst.health?.status || "unknown";
      if (healthFilter === "healthy" && h !== "healthy" && h !== "ok") return false;
      if (healthFilter === "down" && h !== "down" && h !== "error") return false;
      if (healthFilter === "degraded" && (h === "healthy" || h === "ok" || h === "down" || h === "error"))
        return false;
      return true;
    });
  }, [items, search, healthFilter]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const slugValue = slug.trim();
    try {
      await api("/instances", {
        method: "POST",
        body: JSON.stringify({
          slug: slugValue,
          ...instanceWriteBody({ ...runtimeForm, displayName: runtimeForm.displayName || slugValue }),
        }),
      });
      if (status !== "registered") {
        await api(`/instances/${slugValue}`, {
          method: "PUT",
          body: JSON.stringify({ status }),
        });
      }
      setCreateOpen(false);
      setSlug("");
      setRuntimeForm(emptyRuntimeForm());
      load();
      navigate(`/instances/${slugValue}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(slug: string) {
    if (!confirm(`Delete instance "${slug}"? This cannot be undone.`)) return;
    try {
      await api(`/instances/${slug}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function pingAll() {
    try {
      await api("/health/ping-all", { method: "POST" });
      setTimeout(load, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ping failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Instances"
        subtitle={`Register and manage AI agent runtime instances · ${portalMode === "demo" ? "Demo" : "Internal"} portal preview`}
        actions={
          <>
            <Link to="/instances/channels" className="badge">
              Channel matrix
            </Link>
            <button type="button" className="secondary" onClick={pingAll}>
              Ping all
            </button>
            <button type="button" onClick={() => setCreateOpen(true)}>
              Add instance
            </button>
          </>
        }
      />

      {error && <p className="badge bad" style={{ marginBottom: "1rem" }}>{error}</p>}

      <div className="toolbar">
        <input
          placeholder="Search slug or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
          <option value="all">All health</option>
          <option value="healthy">Healthy</option>
          <option value="degraded">Degraded / unknown</option>
          <option value="down">Down</option>
        </select>
        <span className="muted">{filtered.length} of {items.length}</span>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          message="No instances match your filters."
          action={
            <button type="button" onClick={() => setCreateOpen(true)}>
              Add first instance
            </button>
          }
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Profile</th>
              <th>Instance</th>
              <th>Runtime</th>
              <th>Health</th>
              <th>Endpoints</th>
              <th>Status</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((inst) => {
              const preview = previews[inst.slug];
              return (
                <tr key={inst.id}>
                  <td>
                    <InstanceProfileAvatar
                      slug={inst.slug}
                      imageId={preview?.image_id}
                      size={44}
                      title={
                        preview
                          ? `${preview.image_type} profile`
                          : `No ${portalMode === "demo" ? "public" : "internal/public"} image`
                      }
                    />
                  </td>
                  <td>
                    <Link to={`/instances/${inst.slug}`}>
                      <strong>{instanceDisplayName(inst)}</strong>
                    </Link>
                    <div className="muted">{inst.slug}</div>
                  </td>
                  <td>
                    <span className="badge">
                      {RUNTIME_LABELS[classifyBotRuntime(inst.identity?.runtime)]}
                    </span>
                  </td>
                  <td>
                    <HealthBadge status={inst.health?.status} />
                    {tlsSelfSignedWarning(
                      normalizeTls((inst.tls as InstanceTls) || undefined),
                    ) && (
                      <div className="badge warn" style={{ marginTop: "0.25rem", fontSize: "0.7rem" }}>
                        self-signed TLS
                      </div>
                    )}
                    {inst.health?.http_warning && (
                      <div className="badge warn" style={{ marginTop: "0.25rem", fontSize: "0.7rem" }} title={inst.health.http_warning}>
                        HTTP
                      </div>
                    )}
                  </td>
                  <td>
                    <EndpointStack inst={inst} />
                  </td>
                  <td>
                    <span className="badge">{inst.status || "—"}</span>
                  </td>
                  <td className="muted">{formatTs(inst.lastSeen)}</td>
                  <td>
                    <div className="row-actions">
                      <Link to={`/instances/${inst.slug}`} className="badge">
                        Manage
                      </Link>
                      <button type="button" className="danger" onClick={() => onDelete(inst.slug)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Modal
        open={createOpen}
        title="Add instance"
        onClose={() => {
          setCreateOpen(false);
          setRuntimeForm(emptyRuntimeForm());
        }}
        wide
      >
        <form onSubmit={onCreate}>
          <div className="form-grid" style={{ marginBottom: "1rem" }}>
            <label>
              Slug *
              <input
                required
                pattern="[a-z0-9][a-z0-9-]*"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="oc-white"
              />
            </label>
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="registered">registered</option>
                <option value="active">active</option>
                <option value="maintenance">maintenance</option>
              </select>
            </label>
          </div>
          <InstanceRuntimeFields value={runtimeForm} onChange={setRuntimeForm} />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create instance"}
            </button>
            <button type="button" className="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
