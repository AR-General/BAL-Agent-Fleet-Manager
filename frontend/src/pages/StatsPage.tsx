import { useEffect, useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/common/PageHeader";

type ErrorRow = {
  instance_slug: string;
  source: string;
  error?: string;
  type?: string;
  ts: string;
};

export function StatsPage() {
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [snapshots, setSnapshots] = useState<
    Array<{ id: string; period: string; fetchedAt: string; data: Record<string, number> }>
  >([]);
  const [loadError, setLoadError] = useState("");
  const [scraping, setScraping] = useState(false);

  const load = () => {
    Promise.all([
      api<{ ok: boolean; metrics: Record<string, number> }>("/stats/twilio/metrics"),
      api<{ errors: ErrorRow[] }>("/stats/errors"),
      api<{ snapshots: typeof snapshots }>("/stats/usage"),
    ])
      .then(([m, e, u]) => {
        setMetrics(m.metrics || {});
        setErrors(e.errors);
        setSnapshots(u.snapshots);
        setLoadError("");
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed"));
  };

  useEffect(() => load(), []);

  async function scrape() {
    setScraping(true);
    try {
      await api("/stats/twilio/scrape", { method: "POST" });
      load();
    } finally {
      setScraping(false);
    }
  }

  const metricEntries = Object.entries(metrics).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Stats"
        subtitle="Twilio bridge metrics, usage snapshots, and fleet errors"
        actions={
          <button type="button" onClick={scrape} disabled={scraping}>
            {scraping ? "Scraping…" : "Scrape & store metrics"}
          </button>
        }
      />

      {loadError && <p className="badge bad">{loadError}</p>}

      <h2>Live Twilio metrics</h2>
      {metricEntries.length === 0 ? (
        <p className="muted">No metrics from bridge (check TWILIO_BRIDGE_INTERNAL_URL).</p>
      ) : (
        <div className="grid">
          {metricEntries.map(([k, v]) => (
            <div key={k} className="stat-card">
              <span className="muted">{k}</span>
              <strong>{Number.isInteger(v) ? v : v.toFixed(2)}</strong>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: "2rem" }}>Usage snapshots</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Fetched</th>
            <th>Metrics captured</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.id}>
              <td>{s.period}</td>
              <td>{new Date(s.fetchedAt).toLocaleString()}</td>
              <td className="muted">{Object.keys(s.data || {}).length} keys</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: "2rem" }}>Error log</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Instance</th>
            <th>Source</th>
            <th>Detail</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e, i) => (
            <tr key={i}>
              <td>{e.instance_slug}</td>
              <td>{e.source}</td>
              <td className="muted">{e.error || e.type || "—"}</td>
              <td>{new Date(e.ts).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
