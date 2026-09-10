import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { usePortalMode } from "../../stores/portalMode";
import type { InstanceImageMeta, ProfileImageGroupSettings, ProfileImageSettings } from "../../types";
import { AuthenticatedImage, invalidateAuthenticatedImageCache } from "../common/AuthenticatedImage";
import { fileToBase64 } from "../../utils/fileBase64";

type Props = {
  slug: string;
};

const DEFAULT_GROUP: ProfileImageGroupSettings = {
  auto_rotate: false,
  rotate_interval_sec: null,
};

const DEFAULT_SETTINGS: ProfileImageSettings = {
  public: { ...DEFAULT_GROUP },
  internal: { ...DEFAULT_GROUP },
};

function ImageCard({
  slug,
  imageType,
  img,
  autoRotate,
  onSaved,
  onDelete,
  onSetPrimary,
}: {
  slug: string;
  imageType: string;
  img: InstanceImageMeta;
  autoRotate: boolean;
  onSaved: () => void;
  onDelete: () => void;
  onSetPrimary: () => Promise<void>;
}) {
  const [label, setLabel] = useState(img.label ?? "");
  const [probability, setProbability] = useState(img.probability?.toString() ?? "");
  const [sortOrder, setSortOrder] = useState(String(img.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLabel(img.label ?? "");
    setProbability(img.probability?.toString() ?? "");
    setSortOrder(String(img.sortOrder ?? 0));
  }, [img]);

  async function saveFields() {
    setSaving(true);
    try {
      await api(`/instances/${slug}/images/${img.id}`, {
        method: "PUT",
        body: JSON.stringify({
          label: label.trim() || null,
          probability: probability === "" ? null : Number(probability),
          sort_order: Number(sortOrder) || 0,
        }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function markPrimary() {
    await api(`/instances/${slug}/images/${img.id}`, {
      method: "PUT",
      body: JSON.stringify({ is_primary: true }),
    });
    invalidateAuthenticatedImageCache(`/instances/${slug}/images`);
    onSetPrimary();
  }

  return (
    <div className={`card profile-img-card ${img.isPrimary ? "profile-img-primary" : ""}`} style={{ padding: "0.5rem", width: 200 }}>
      {img.isPrimary && <span className="badge ok profile-primary-badge">Primary</span>}
      <AuthenticatedImage
        apiPath={`/instances/${slug}/images/${img.id}`}
        alt={label || imageType}
        lightboxTitle={[label, imageType, slug].filter(Boolean).join(" · ")}
        enlargeable
        style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, display: "block" }}
        fallbackClassName="auth-img-fallback"
      />
      <label style={{ display: "block", marginTop: "0.5rem" }}>
        Label
        <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => void saveFields()} />
      </label>
      <label style={{ display: "block", marginTop: "0.35rem" }}>
        Probability (0–100)
        <input
          type="number"
          min={0}
          max={100}
          placeholder="optional"
          value={probability}
          onChange={(e) => setProbability(e.target.value)}
          onBlur={() => void saveFields()}
        />
      </label>
      <label style={{ display: "block", marginTop: "0.35rem" }}>
        Sort order
        <input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          onBlur={() => void saveFields()}
        />
      </label>
      <div className="toolbar" style={{ marginTop: "0.5rem", flexWrap: "wrap" }}>
        {!autoRotate && !img.isPrimary && (
          <button type="button" className="secondary" onClick={() => void markPrimary()}>
            Set primary
          </button>
        )}
        <button type="button" className="secondary" disabled={saving} onClick={() => void saveFields()}>
          {saving ? "…" : "Save"}
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

function ImageGroupPanel({
  title,
  imageType,
  slug,
  images,
  autoRotate,
  onRefresh,
}: {
  title: string;
  imageType: "public" | "internal";
  slug: string;
  images: InstanceImageMeta[];
  autoRotate: boolean;
  onRefresh: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const groupImages = images.filter((img) => img.imageType === imageType);

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const b64 = await fileToBase64(file);
      await api(`/instances/${slug}/images`, {
        method: "POST",
        body: JSON.stringify({
          image_type: imageType,
          mime_type: file.type || "image/png",
          data_base64: b64,
          sort_order: groupImages.length,
        }),
      });
      invalidateAuthenticatedImageCache(`/instances/${slug}/images`);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function deleteImage(imageId: string) {
    if (!confirm("Delete this profile image?")) return;
    await api(`/instances/${slug}/images/${imageId}`, { method: "DELETE" });
    invalidateAuthenticatedImageCache(`/instances/${slug}/images`);
    onRefresh();
  }

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h3>{title}</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {autoRotate
          ? "Multiple images rotate by interval or weighted probability (0–100)."
          : "Rotation off — mark one image as primary (used in demo portal and instance list previews)."}
      </p>

      {error && <p className="badge bad">{error}</p>}

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {groupImages.length === 0 ? (
          <p className="muted">No {imageType} images yet.</p>
        ) : (
          groupImages.map((img) => (
            <ImageCard
              key={img.id}
              slug={slug}
              imageType={imageType}
              img={img}
              autoRotate={autoRotate}
              onSaved={onRefresh}
              onSetPrimary={onRefresh}
              onDelete={() => void deleteImage(img.id)}
            />
          ))
        )}
      </div>

      <label>
        Upload {imageType} image
        <input
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

export function InstanceProfilePanel({ slug }: Props) {
  const portalMode = usePortalMode((s) => s.mode);
  const isInternalPortal = portalMode === "internal";
  const [settings, setSettings] = useState<ProfileImageSettings>(DEFAULT_SETTINGS);
  const [images, setImages] = useState<InstanceImageMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api<{ settings: ProfileImageSettings; images: InstanceImageMeta[] }>(
        `/instances/${slug}/images`,
      );
      setSettings(r.settings);
      setImages(r.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile images");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateGroup(type: "public" | "internal", patch: Partial<ProfileImageGroupSettings>) {
    setSettings((prev) => ({
      ...prev,
      [type]: { ...prev[type], ...patch },
    }));
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const r = await api<{ settings: ProfileImageSettings }>(`/instances/${slug}/images/settings`, {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(r.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Loading profile images…</p>;

  return (
    <>
      {error && <p className="badge bad">{error}</p>}

      <p className={`badge ${isInternalPortal ? "" : "ok"}`} style={{ marginBottom: "0.75rem" }}>
        Portal preview: {isInternalPortal ? "Internal (public + internal images)" : "Demo (public images only)"}
      </p>

      <form onSubmit={saveSettings} className="card">
        <h3>Rotation settings</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Configure auto-rotation per visibility group. Save settings separately from image uploads.
        </p>
        <div className={isInternalPortal ? "split" : ""}>
          <div>
            <h4>Public</h4>
            <label>
              <input
                type="checkbox"
                checked={settings.public.auto_rotate}
                onChange={(e) => updateGroup("public", { auto_rotate: e.target.checked })}
              />{" "}
              Auto rotate
            </label>
            <label style={{ display: "block", marginTop: "0.5rem" }}>
              Interval (sec)
              <input
                type="number"
                min={1}
                value={settings.public.rotate_interval_sec ?? ""}
                disabled={!settings.public.auto_rotate}
                onChange={(e) =>
                  updateGroup("public", {
                    rotate_interval_sec: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
            {!settings.public.auto_rotate && (
              <p className="muted ch-field-hint">
                Demo portal uses the primary public image when rotation is off.
              </p>
            )}
          </div>
          {isInternalPortal && (
            <div>
              <h4>Internal</h4>
              <label>
                <input
                  type="checkbox"
                  checked={settings.internal.auto_rotate}
                  onChange={(e) => updateGroup("internal", { auto_rotate: e.target.checked })}
                />{" "}
                Auto rotate
              </label>
              <label style={{ display: "block", marginTop: "0.5rem" }}>
                Interval (sec)
                <input
                  type="number"
                  min={1}
                  value={settings.internal.rotate_interval_sec ?? ""}
                  disabled={!settings.internal.auto_rotate}
                  onChange={(e) =>
                    updateGroup("internal", {
                      rotate_interval_sec: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
            </div>
          )}
        </div>
        <button type="submit" disabled={saving} style={{ marginTop: "1rem" }}>
          {saving ? "Saving…" : "Save rotation settings"}
        </button>
      </form>

      <ImageGroupPanel
        title="Public profile pictures"
        imageType="public"
        slug={slug}
        images={images}
        autoRotate={settings.public.auto_rotate}
        onRefresh={() => void load()}
      />

      {isInternalPortal && (
        <ImageGroupPanel
          title="Internal profile pictures"
          imageType="internal"
          slug={slug}
          images={images}
          autoRotate={settings.internal.auto_rotate}
          onRefresh={() => void load()}
        />
      )}
    </>
  );
}
