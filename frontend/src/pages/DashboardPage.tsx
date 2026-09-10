import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { DbInstance } from "../types";
import { PageHeader } from "../components/common/PageHeader";
import { HealthBadge } from "../components/common/HealthBadge";
import { instanceDisplayName, formatTs } from "../utils/instance";

type FleetSummary = {
  instances: Array<{
    slug: string;
    health: { status?: string };
    status: string;
    last_seen: string | null;
  }>;
  ts: string;
};

export function DashboardPage() {
  const [fleet, setFleet] = useState<FleetSummary | null>(null);
  const [instances, setInstances] = useState<DbInstance[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<FleetSummary>("/instances/fleet/summary"),
      api<{ instances: DbInstance[] }>("/instances"),
      api<{ errors: Array<{ instance_slug: string; error?: string; ts: string }> }>("/stats/errors").catch(
        () => ({ errors: [] }),
      ),
    ])
      .then(([f, i]) => {
        setFleet(f);
        setInstances(i.instances);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  if (error) return <p className="badge bad">{error}</p>;
  if (!fleet) return <p className="muted">Loading…</p>;

  const counts = { healthy: 0, degraded: 0, down: 0 };
  for (const inst of fleet.instances) {
    const s = inst.health?.status || "unknown";
    if (s === "healthy" || s === "ok") counts.healthy++;
    else if (s === "down" || s === "error") counts.down++;
    else counts.degraded++;
  }

  const bySlug = new Map(instances.map((i) => [i.slug, i]));
  const recent = [...instances].sort((a, b) => {
    const ta = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
    const tb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
    return tb - ta;
  });

  return (
    <>
      <PageHeader title="Dashboard" subtitle="AI agents and runtime instances at a glance" />

      <div className="stat-row">
        <div className="stat-card">
          <span className="muted">Instances</span>
          <strong>{fleet.instances.length}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">Healthy</span>
          <strong style={{ color: "var(--ok)" }}>{counts.healthy}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">Degraded</span>
          <strong style={{ color: "var(--warn)" }}>{counts.degraded}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">Down</span>
          <strong style={{ color: "var(--bad)" }}>{counts.down}</strong>
        </div>
      </div>

      <div className="toolbar">
        <Link to="/instances">
          <button type="button">Manage instances</button>
        </Link>
        <Link to="/chat">
          <button type="button" className="secondary">
            Open chat
          </button>
        </Link>
      </div>

      <h2>Instances</h2>
      <div className="grid">
        {fleet.instances.map((inst) => {
          const row = bySlug.get(inst.slug);
          const card: DbInstance = row || {
            id: inst.slug,
            slug: inst.slug,
            identity: {},
            ports: {},
            health: inst.health,
            lastSeen: inst.last_seen,
            host: null,
            urls: {},
            channels: {},
            status: inst.status,
          };
          return (
            <Link key={inst.slug} to={`/instances/${inst.slug}`} className="card" style={{ color: "inherit" }}>
              <HealthBadge status={inst.health?.status} />
              <strong>{instanceDisplayName(card)}</strong>
              <div className="muted">{inst.slug}</div>
              <div className="muted" style={{ marginTop: "0.35rem" }}>
                Last seen: {formatTs(card.lastSeen)}
              </div>
            </Link>
          );
        })}
      </div>

      <h2 style={{ marginTop: "2rem" }}>Recently active</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Health</th>
            <th>Host</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {recent.slice(0, 8).map((inst) => (
            <tr key={inst.id}>
              <td>
                <Link to={`/instances/${inst.slug}`}>{instanceDisplayName(inst)}</Link>
              </td>
              <td>
                <HealthBadge status={inst.health?.status} />
              </td>
              <td>{inst.host || "—"}</td>
              <td className="muted">{formatTs(inst.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
