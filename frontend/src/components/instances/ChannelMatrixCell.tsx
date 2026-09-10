import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { DbInstance } from "../../types";
import type { InstanceChannelMeta } from "../../constants/instanceChannels";
import type { MatrixChannelCell } from "../../types/channelsMatrix";
import { finalizeChannelConfig, normalizeChannelConfig } from "../../utils/channelConfig";
import { ChannelEditorPanel } from "./ChannelEditorPanel";

type Props = {
  slug: string;
  channelType: string;
  meta: InstanceChannelMeta;
  cell: MatrixChannelCell;
  showFull: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onSaveConfig: (config: Record<string, unknown>, status: string | null, enabled: boolean) => Promise<void>;
};

function matrixStateClass(cell: MatrixChannelCell): string {
  if (!cell.configured) return "ch-off";
  if (cell.enabled) return "ch-on";
  return "ch-cfg";
}

export function ChannelMatrixCell({
  slug,
  channelType,
  meta,
  cell,
  showFull,
  onToggle,
  onSaveConfig,
}: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [instance, setInstance] = useState<DbInstance | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const stateClass = matrixStateClass(cell);

  const title = [
    meta.label,
    cell.configured ? (cell.enabled ? "enabled" : "configured, disabled") : "not configured",
    cell.summary ? `— ${cell.summary}` : "",
    cell.status ? `status: ${cell.status}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  function openEditor() {
    setConfig(normalizeChannelConfig(channelType, cell.config || {}));
    setStatus(cell.status);
    setEnabled(cell.enabled);
    setErr("");
    setPopoverOpen(false);
    setEditorOpen(true);
  }

  useEffect(() => {
    if (!editorOpen) return;
    api<DbInstance>(`/instances/${slug}`)
      .then(setInstance)
      .catch(() => setInstance(null));
  }, [editorOpen, slug]);

  async function saveEditor() {
    setSaving(true);
    setErr("");
    try {
      await onSaveConfig(finalizeChannelConfig(channelType, config), status, enabled);
      setEditorOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <td className={`ch-matrix-cell ${stateClass}`}>
      <button
        type="button"
        className="ch-matrix-hit"
        title={title}
        aria-label={title}
        onClick={() => (showFull ? openEditor() : setPopoverOpen((v) => !v))}
      >
        {showFull && cell.summary ? (
          <span className="ch-summary">{cell.summary}</span>
        ) : (
          <span className={`ch-dot ${stateClass}`} aria-hidden />
        )}
      </button>

      {popoverOpen && !showFull && (
        <div className="ch-popover">
          <div className="ch-popover-head">
            <strong>
              {meta.icon} {meta.label}
            </strong>
            <button type="button" className="secondary" onClick={() => setPopoverOpen(false)}>
              ×
            </button>
          </div>
          <p className="ch-pop-state">
            <span className={`ch-dot ${stateClass}`} aria-hidden />
            {cell.configured ? (cell.enabled ? "Enabled" : "Configured, disabled") : "Not configured"}
          </p>
          {cell.summary && <p className="muted ch-pop-summary">{cell.summary}</p>}
          {cell.status && (
            <p className="muted">
              Status: <span className="badge">{cell.status}</span>
            </p>
          )}
          <div className="ch-pop-actions">
            {cell.configured && (
              <button
                type="button"
                className="secondary"
                onClick={() => void onToggle(!cell.enabled).then(() => setPopoverOpen(false))}
              >
                {cell.enabled ? "Disable" : "Enable"}
              </button>
            )}
            <button type="button" className="secondary" onClick={openEditor}>
              Edit config
            </button>
            <Link to={`/instances/${slug}/channels`} className="badge">
              Full editor
            </Link>
          </div>
        </div>
      )}

      {editorOpen && (
        <div className="ch-editor-overlay" onClick={() => setEditorOpen(false)} role="presentation">
          <div className="ch-editor-panel wide" onClick={(e) => e.stopPropagation()}>
            {err && <p className="badge bad">{err}</p>}
            <ChannelEditorPanel
              channelType={channelType}
              config={config}
              status={status}
              enabled={enabled}
              instanceSlug={slug}
              instanceId={instance?.id ?? null}
              instanceUrls={(instance?.urls || {}) as Record<string, string>}
              onConfigChange={setConfig}
              onStatusChange={setStatus}
              onEnabledChange={setEnabled}
              compact
            />
            <div className="ch-pop-actions" style={{ marginTop: "1rem" }}>
              <button type="button" disabled={saving} onClick={() => void saveEditor()}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" className="secondary" onClick={() => setEditorOpen(false)}>
                Cancel
              </button>
              <Link to={`/instances/${slug}/channels`} className="badge">
                Open full editor
              </Link>
            </div>
          </div>
        </div>
      )}
    </td>
  );
}
