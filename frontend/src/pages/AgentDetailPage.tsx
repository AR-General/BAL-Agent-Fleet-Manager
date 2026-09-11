import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { AgentProfile } from "../types";
import { PageHeader } from "../components/common/PageHeader";
import { usePortalMode } from "../stores/portalMode";
import { useViewMode } from "../stores/viewMode";
import { AuthenticatedImage, invalidateAuthenticatedImageCache } from "../components/common/AuthenticatedImage";
import { fileToBase64 } from "../utils/fileBase64";
import { AgentAvatarVoiceEditor } from "../components/agents/AgentAvatarVoiceEditor";
import { ConnectAgentPanel } from "../components/agents/ConnectAgentPanel";
import { classifyBotRuntime, RUNTIME_LABELS } from "../lib/botRuntime";

type ImageMeta = { id: string; image_type: string; mime_type: string };

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { mode } = useViewMode();
  const portalMode = usePortalMode((s) => s.mode);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [images, setImages] = useState<ImageMeta[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api<{ profile: AgentProfile; images: ImageMeta[] }>(`/agents/${id}`).then((r) => {
      setProfile(r.profile);
      setImages(r.images);
    });
  }, [id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!profile || !id) return;
    setSaving(true);
    try {
      const updated = await api<AgentProfile>(`/agents/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName: profile.displayName,
          roleDescription: profile.roleDescription,
          publicBio: profile.publicBio,
          internalNotes: profile.internalNotes,
          isPublic: profile.isPublic,
        }),
      });
      setProfile(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(file: File, imageType: "public" | "internal") {
    if (!id) return;
    const b64 = await fileToBase64(file);
    await api(`/agents/${id}/images`, {
      method: "POST",
      body: JSON.stringify({ image_type: imageType, mime_type: file.type, data_base64: b64 }),
    });
    invalidateAuthenticatedImageCache(`/agents/${id}/images`);
    const r = await api<{ profile: AgentProfile; images: ImageMeta[] }>(`/agents/${id}`);
    setImages(r.images);
  }

  if (!profile) return <p className="muted">Loading…</p>;

  const showInternal = mode === "operator" && portalMode === "internal";
  const visibleImages = images.filter(
    (img) => portalMode === "internal" || img.image_type === "public",
  );

  return (
    <>
      <PageHeader
        title={profile.displayName || profile.agentId}
        subtitle={`${profile.agentId} · ${RUNTIME_LABELS[classifyBotRuntime(profile.runtime)]} · instance ${profile.instance_slug ?? ""}`}
        backTo="/agents"
        actions={
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (!id) return;
              if (!confirm(`Delete agent "${profile.displayName || profile.agentId}"?`)) return;
              void api(`/agents/${id}`, { method: "DELETE" })
                .then(() => navigate("/agents"))
                .catch((err) => setError(err instanceof Error ? err.message : "Delete failed"));
            }}
          >
            Delete
          </button>
        }
      />
      {error && <p className="badge bad">{error}</p>}

      <form onSubmit={save} className="card" style={{ maxWidth: 640 }}>
        <div className="form-grid">
          <label>
            Display name
            <input
              value={profile.displayName || ""}
              onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
            />
          </label>
          <label>
            Agent ID
            <input disabled value={profile.agentId} />
          </label>
          <label className="full">
            Role description
            <input
              value={profile.roleDescription || ""}
              onChange={(e) => setProfile({ ...profile, roleDescription: e.target.value })}
            />
          </label>
          <label className="full">
            Public bio
            <textarea
              rows={4}
              value={profile.publicBio || ""}
              onChange={(e) => setProfile({ ...profile, publicBio: e.target.value })}
            />
          </label>
          {showInternal && (
            <label className="full">
              Internal notes
              <textarea
                rows={4}
                value={profile.internalNotes || ""}
                onChange={(e) => setProfile({ ...profile, internalNotes: e.target.value })}
              />
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={profile.isPublic}
              onChange={(e) => setProfile({ ...profile, isPublic: e.target.checked })}
            />{" "}
            Public profile
          </label>
        </div>
        <button type="submit" disabled={saving} style={{ marginTop: "1rem" }}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>

      {profile.instance_slug ? (
        <>
          <div style={{ marginTop: "1.25rem", maxWidth: 720 }}>
            <ConnectAgentPanel instanceSlug={profile.instance_slug} />
            <p className="muted">
              Generate the secret key on{" "}
              <Link to={`/instances/${profile.instance_slug}`}>
                Instance {profile.instance_slug} → API tokens
              </Link>
              .
            </p>
          </div>
          <AgentAvatarVoiceEditor slug={profile.instance_slug} />
        </>
      ) : null}

      <h2 style={{ marginTop: "2rem" }}>Images</h2>
      <p className="muted">
        Portal preview: {portalMode === "demo" ? "public images only" : "public + internal"}
      </p>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {visibleImages.map((img) => (
          <div key={img.id} className="card" style={{ padding: "0.5rem" }}>
            <AuthenticatedImage
              apiPath={`/agents/${id}/images/${img.id}`}
              alt={img.image_type}
              lightboxTitle={`${profile.displayName || profile.agentId} · ${img.image_type}`}
              enlargeable
              style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, display: "block" }}
            />
            <div className="muted">{img.image_type}</div>
          </div>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: "1rem" }}>
        <label>
          Public image
          <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], "public")} />
        </label>
        {showInternal && (
          <label>
            Internal image
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], "internal")} />
          </label>
        )}
      </div>
    </>
  );
}
