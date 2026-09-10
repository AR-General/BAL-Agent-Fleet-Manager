import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { PageHeader } from "../components/common/PageHeader";
import { VrmPreviewCanvas } from "../components/vrm/VrmPreviewCanvas";
import { useResolvedVrmUrl } from "../hooks/useResolvedVrmUrl";
import { formatBytes, libraryVrmRef, type VrmModel } from "../lib/vrmLibrary";

export function VrmModelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [model, setModel] = useState<VrmModel | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const previewUrl = useResolvedVrmUrl(model ? libraryVrmRef(model.id) : "");

  useEffect(() => {
    if (!id) return;
    void api<{ model: VrmModel }>(`/vrm-models/${id}`)
      .then((r) => {
        setModel(r.model);
        setName(r.model.name);
        setDescription(r.model.description || "");
        setHidden(r.model.hidden);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    setError("");
    try {
      const r = await api<{ model: VrmModel }>(`/vrm-models/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, description, hidden }),
      });
      setModel(r.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!id || !model) return;
    const msg =
      model.source === "directory"
        ? "Hide this directory VRM from the library? The file stays on disk."
        : "Delete this uploaded VRM? This cannot be undone.";
    if (!confirm(msg)) return;
    try {
      await api(`/vrm-models/${id}`, { method: "DELETE" });
      navigate("/vrms");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (!model && !error) return <p className="muted">Loading…</p>;
  if (!model) {
    return (
      <>
        <PageHeader title="VRM" backTo="/vrms" />
        <p className="badge bad">{error}</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={model.name}
        subtitle={`${model.source} · ${formatBytes(model.file_size)}`}
        backTo="/vrms"
        actions={
          <button type="button" className="danger" onClick={() => void remove()}>
            {model.source === "directory" ? "Hide" : "Delete"}
          </button>
        }
      />
      {error ? <p className="badge bad">{error}</p> : null}
      {model.missing ? <p className="badge bad">File missing on disk</p> : null}

      <div className="split">
        <form className="card" onSubmit={(e) => void save(e)}>
          <div className="form-grid">
            <label className="full">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="full">
              Description
              <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label>
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hidden
            </label>
          </div>
          {model.relative_path ? (
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              Path: <code>{model.relative_path}</code>
            </p>
          ) : null}
          {model.original_filename ? (
            <p className="muted">
              File: <code>{model.original_filename}</code>
            </p>
          ) : null}
          <button type="submit" disabled={saving} style={{ marginTop: "1rem" }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
        <div className="card">
          <h3>Preview</h3>
          {previewUrl && !model.missing ? (
            <VrmPreviewCanvas vrmUrl={previewUrl} height={420} />
          ) : (
            <p className="muted">No file to preview.</p>
          )}
        </div>
      </div>
    </>
  );
}
