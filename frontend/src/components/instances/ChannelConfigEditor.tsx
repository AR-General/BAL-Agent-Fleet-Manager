import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { DbInstance, InstanceChannelConfig } from "../../types";
import { INSTANCE_CHANNEL_TYPES, INSTANCE_CHANNEL_META } from "../../constants/instanceChannels";
import { channelTypeIcon, channelTypeLabel } from "../../constants/channelSchemas";
import { finalizeChannelConfig, normalizeChannelConfig } from "../../utils/channelConfig";
import { ChannelEditorPanel } from "./ChannelEditorPanel";

const CHANNEL_TYPES = INSTANCE_CHANNEL_TYPES;

type Props = {
  slug: string;
  onSaved?: (instanceChannels: Record<string, unknown>) => void;
};

type ChannelDraft = InstanceChannelConfig & {
  config: Record<string, unknown>;
};

function emptyChannel(type: string): ChannelDraft {
  return {
    id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    channelType: type,
    enabled: false,
    config: {},
    status: null,
  };
}

export function ChannelConfigEditor({ slug, onSaved }: Props) {
  const [instance, setInstance] = useState<DbInstance | null>(null);
  const [channels, setChannels] = useState<ChannelDraft[]>([]);
  const [instanceChannels, setInstanceChannels] = useState<Record<string, unknown>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [addType, setAddType] = useState<string>(CHANNEL_TYPES[0]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [inst, ch] = await Promise.all([
        api<DbInstance>(`/instances/${slug}`),
        api<{ configured: InstanceChannelConfig[]; instance_channels: Record<string, unknown> }>(
          `/channels/instance/${slug}`,
        ),
      ]);
      setInstance(inst);
      setChannels(
        ch.configured.map((row) => ({
          ...row,
          config: normalizeChannelConfig(row.channelType, (row.config || {}) as Record<string, unknown>),
        })),
      );
      setInstanceChannels(ch.instance_channels || {});
      setExpandedId((prev) => {
        if (prev && ch.configured.some((c) => c.id === prev)) return prev;
        return ch.configured[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [slug]);

  function updateChannel(idx: number, patch: Partial<ChannelDraft>) {
    setChannels((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function updateConfig(idx: number, config: Record<string, unknown>) {
    updateChannel(idx, { config });
  }

  function addChannel() {
    if (channels.some((c) => c.channelType === addType)) {
      setError(`Channel type "${addType}" already exists`);
      return;
    }
    const ch = emptyChannel(addType);
    setChannels((prev) => [...prev, ch]);
    setExpandedId(ch.id);
    setError("");
  }

  function removeChannel(idx: number) {
    const id = channels[idx]?.id;
    setChannels((prev) => prev.filter((_, i) => i !== idx));
    if (expandedId === id) setExpandedId(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = channels.map((ch) => ({
        channel_type: ch.channelType,
        enabled: ch.enabled,
        config: finalizeChannelConfig(ch.channelType, ch.config),
        status: ch.status,
      }));

      const r = await api<{ configured: InstanceChannelConfig[]; instance_channels: Record<string, unknown> }>(
        `/channels/instance/${slug}`,
        {
          method: "PUT",
          body: JSON.stringify({ channels: payload }),
        },
      );
      setChannels(
        r.configured.map((row) => ({
          ...row,
          config: normalizeChannelConfig(row.channelType, (row.config || {}) as Record<string, unknown>),
        })),
      );
      setInstanceChannels(r.instance_channels);
      onSaved?.(r.instance_channels);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const usedTypes = new Set(channels.map((c) => c.channelType));
  const availableTypes = CHANNEL_TYPES.filter((t) => !usedTypes.has(t));
  const instanceUrls = (instance?.urls || {}) as Record<string, string>;

  if (loading) return <p className="muted">Loading channels…</p>;

  return (
    <form onSubmit={save} className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h3 style={{ margin: 0 }}>Channel configurations</h3>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Per-channel credentials and fleet phone lines.{" "}
            <Link to="/instances/channels">Fleet matrix</Link>
          </p>
        </div>
        <div className="toolbar">
          {availableTypes.length > 0 && (
            <>
              <select value={addType} onChange={(e) => setAddType(e.target.value)}>
                {availableTypes.map((t) => (
                  <option key={t} value={t}>
                    {channelTypeIcon(t)} {channelTypeLabel(t)}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary" onClick={addChannel}>
                Add channel
              </button>
            </>
          )}
          <button type="button" className="secondary" onClick={() => void load()}>
            Reload
          </button>
        </div>
      </div>

      {error && (
        <p className="badge bad" style={{ marginTop: "0.75rem" }}>
          {error}
        </p>
      )}

      {channels.length === 0 ? (
        <p className="muted" style={{ marginTop: "1rem" }}>
          No channels configured. Add a channel type to get started.
        </p>
      ) : (
        <div className="ch-channel-list">
          {channels.map((ch, idx) => {
            const meta = INSTANCE_CHANNEL_META[ch.channelType as keyof typeof INSTANCE_CHANNEL_META];
            const open = expandedId === ch.id;
            return (
              <section
                key={ch.id}
                className={`ch-channel-card ${open ? "open" : ""}`}
              >
                <button
                  type="button"
                  className="ch-channel-card-head"
                  onClick={() => setExpandedId(open ? null : ch.id)}
                >
                  <span className="ch-icon">{meta?.icon ?? "📡"}</span>
                  <span>
                    <strong>{meta?.label ?? ch.channelType}</strong>
                    <span className="muted"> · {ch.channelType}</span>
                  </span>
                  <span className={`badge ${ch.enabled ? "ok" : ""}`}>{ch.enabled ? "on" : "off"}</span>
                  {ch.status && <span className="badge">{ch.status}</span>}
                </button>

                {open && (
                  <div className="ch-channel-card-body">
                    <ChannelEditorPanel
                      channelType={ch.channelType}
                      config={ch.config}
                      status={ch.status}
                      enabled={ch.enabled}
                      instanceSlug={slug}
                      instanceId={instance?.id ?? null}
                      instanceUrls={instanceUrls}
                      onConfigChange={(config) => updateConfig(idx, config)}
                      onStatusChange={(status) => updateChannel(idx, { status })}
                      onEnabledChange={(enabled) => updateChannel(idx, { enabled })}
                    />
                    <button type="button" className="danger" onClick={() => removeChannel(idx)}>
                      Remove channel
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <button type="submit" disabled={saving} style={{ marginTop: "1rem" }}>
        {saving ? "Saving…" : "Save all channels"}
      </button>

      <details style={{ marginTop: "1.5rem" }}>
        <summary className="muted">Synced instance channels JSON</summary>
        <pre className="code" style={{ marginTop: "0.5rem" }}>
          {JSON.stringify(instanceChannels, null, 2)}
        </pre>
      </details>
    </form>
  );
}
