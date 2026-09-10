import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { PageHeader } from "../components/common/PageHeader";
import { HealthBadge } from "../components/common/HealthBadge";
import { ChannelMatrixCell } from "../components/instances/ChannelMatrixCell";
import { INSTANCE_CHANNEL_META } from "../constants/instanceChannels";
import type { ChannelsMatrixResponse, MatrixInstanceRow } from "../types/channelsMatrix";

export function InstancesChannelsMatrixPage() {
  const [data, setData] = useState<ChannelsMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api<ChannelsMatrixResponse>("/channels/matrix")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load matrix"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const channelTypes = data?.channel_types ?? [];

  const filteredInstances = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.instances.filter((inst) => {
      if (!q) return true;
      return (
        inst.slug.toLowerCase().includes(q) ||
        inst.display_name.toLowerCase().includes(q) ||
        (inst.host || "").toLowerCase().includes(q)
      );
    });
  }, [data, search]);

  const visibleTypes = useMemo(() => {
    if (typeFilter === "all") return channelTypes;
    return channelTypes.filter((t) => t === typeFilter);
  }, [channelTypes, typeFilter]);

  const patchCell = useCallback(
    async (
      slug: string,
      channelType: string,
      body: {
        enabled: boolean;
        config?: Record<string, unknown>;
        status?: string | null;
      },
    ) => {
      const r = await api<{
        cell: MatrixInstanceRow["channels"][string];
      }>(`/channels/instance/${slug}/by-type/${channelType}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          instances: prev.instances.map((inst) =>
            inst.slug === slug
              ? { ...inst, channels: { ...inst.channels, [channelType]: r.cell } }
              : inst,
          ),
        };
      });
    },
    [],
  );

  return (
    <>
      <PageHeader
        title="Instance channels"
        subtitle="Fleet matrix — configured channels per instance (admin)"
        actions={
          <>
            <Link to="/instances" className="badge">
              ← Instances list
            </Link>
            <button type="button" className="secondary" onClick={load}>
              Reload
            </button>
          </>
        }
      />

      {error && <p className="badge bad" style={{ marginBottom: "1rem" }}>{error}</p>}

      <div className="toolbar">
        <input
          placeholder="Search slug, name, host…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All channel types</option>
          {channelTypes.map((t) => (
            <option key={t} value={t}>
              {INSTANCE_CHANNEL_META[t]?.label ?? t}
            </option>
          ))}
        </select>
        <label className="ch-show-full">
          <input type="checkbox" checked={showFull} onChange={(e) => setShowFull(e.target.checked)} /> Show full
        </label>
        <span className="muted">
          {filteredInstances.length} instance{filteredInstances.length === 1 ? "" : "s"} · click dot for details
        </span>
      </div>

      <div className="ch-legend muted">
        <span>
          <span className="ch-dot ch-on" /> enabled
        </span>
        <span>
          <span className="ch-dot ch-cfg" /> configured off
        </span>
        <span>
          <span className="ch-dot ch-off" /> not configured
        </span>
      </div>

      {loading ? (
        <p className="muted">Loading channel matrix…</p>
      ) : !data || filteredInstances.length === 0 ? (
        <p className="muted">No instances to display.</p>
      ) : (
        <div className="ch-matrix-scroll">
          <table className="table ch-matrix-table">
            <thead>
              <tr>
                <th className="ch-sticky-col">Instance</th>
                <th>Health</th>
                {visibleTypes.map((t) => (
                  <th key={t} className="ch-col-head" title={t}>
                    <div className="ch-col-head-stack">
                      <span className="ch-icon" aria-hidden>
                        {INSTANCE_CHANNEL_META[t]?.icon}
                      </span>
                      <span className="ch-col-label">{INSTANCE_CHANNEL_META[t]?.label ?? t}</span>
                    </div>
                  </th>
                ))}
                <th className="ch-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInstances.map((inst) => (
                <tr key={inst.id}>
                  <td className="ch-sticky-col">
                    <Link to={`/instances/${inst.slug}`}>
                      <strong>{inst.display_name}</strong>
                    </Link>
                    <div className="muted">{inst.slug}</div>
                  </td>
                  <td>
                    <HealthBadge status={inst.health?.status as string | undefined} />
                  </td>
                  {visibleTypes.map((t) => (
                    <ChannelMatrixCell
                      key={`${inst.slug}-${t}`}
                      slug={inst.slug}
                      channelType={t}
                      meta={INSTANCE_CHANNEL_META[t]}
                      cell={inst.channels[t]}
                      showFull={showFull}
                      onToggle={(enabled) =>
                        patchCell(inst.slug, t, {
                          enabled,
                          config: inst.channels[t]?.config,
                          status: inst.channels[t]?.status,
                        })
                      }
                      onSaveConfig={(config, status, enabled) =>
                        patchCell(inst.slug, t, {
                          enabled,
                          config,
                          status,
                        })
                      }
                    />
                  ))}
                  <td className="ch-actions-col">
                    <div className="ch-row-actions">
                      {inst.gateway_url ? (
                        <a
                          href={inst.gateway_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="badge ok"
                          title="Open gateway control UI"
                        >
                          GW ↗
                        </a>
                      ) : (
                        <span className="muted" title="No gateway URL">
                          GW —
                        </span>
                      )}
                      <Link to={`/instances/${inst.slug}/channels`} className="badge" title="Edit channels">
                        Ch
                      </Link>
                      <Link to={`/instances/${inst.slug}`} className="badge" title="Manage instance">
                        ⚙
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
