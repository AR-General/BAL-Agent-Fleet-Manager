import { FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiUpload } from "../api/client";
import { PageHeader } from "../components/common/PageHeader";
import { EmptyState } from "../components/common/EmptyState";
import { formatBytes, type VrmModel } from "../lib/vrmLibrary";
import { useVrmModels } from "../hooks/useVrmModels";

export function VrmModelsPage() {
  const { models, libraryDir, loading, error, reload } = useVrmModels(true);
  const [busy, setBusy] = useState("");
  const [localError, setLocalError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload(file: File | null) {
    if (!file) return;
    setBusy("upload");
    setLocalError("");
    try {
      await apiUpload<{ model: VrmModel }>("/vrm-models/upload", file, file.name, {
        name: file.name.replace(/\.vrm$/i, ""),
      });
      reload();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy("");
    }
  }

  async function onScan() {
    setBusy("scan");
    setLocalError("");
    try {
      await api("/vrm-models/scan", { method: "POST" });
      reload();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy("");
    }
  }

  async function onDelete(model: VrmModel) {
    const msg =
      model.source === "directory"
        ? `Hide "${model.name}" from the library? The file stays on disk in the VRM directory.`
        : `Delete uploaded VRM "${model.name}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    setBusy(model.id);
    setLocalError("");
    try {
      await api(`/vrm-models/${model.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy("");
    }
  }

  const err = localError || error;

  return (
    <>
      <PageHeader
        title="VRMs"
        subtitle="Directory-backed and uploaded VRM avatars. Assign a default on each agent."
        actions={
          <>
            <button type="button" className="secondary" onClick={() => void onScan()} disabled={Boolean(busy)}>
              {busy === "scan" ? "Scanning…" : "Scan directory"}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
              {busy === "upload" ? "Uploading…" : "Upload VRM"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".vrm,model/gltf-binary"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                void onUpload(f);
                e.target.value = "";
              }}
            />
          </>
        }
      />

      {libraryDir ? (
        <p className="muted" style={{ marginTop: "-0.5rem" }}>
          Directory: <code>{libraryDir}</code>
        </p>
      ) : null}
      {err ? <p className="badge bad">{err}</p> : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : models.length === 0 ? (
        <EmptyState
          message="No VRM models yet. Drop .vrm files into the library directory or upload one."
          action={
            <button type="button" onClick={() => fileRef.current?.click()}>
              Upload VRM
            </button>
          }
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th>Size</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link to={`/vrms/${m.id}`}>
                    <strong>{m.name}</strong>
                  </Link>
                  {m.description ? <div className="muted">{m.description}</div> : null}
                  {m.relative_path ? <div className="muted">{m.relative_path}</div> : null}
                </td>
                <td>
                  <span className="badge">{m.source}</span>
                </td>
                <td className="muted">{formatBytes(m.file_size)}</td>
                <td>
                  {m.hidden ? <span className="badge">hidden</span> : null}
                  {m.missing ? <span className="badge bad">file missing</span> : <span className="badge ok">ready</span>}
                </td>
                <td>
                  <div className="row-actions">
                    <Link to={`/vrms/${m.id}`} className="badge">
                      Preview
                    </Link>
                    <button type="button" className="danger" onClick={() => void onDelete(m)} disabled={busy === m.id}>
                      {m.source === "directory" ? "Hide" : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
