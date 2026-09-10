import { FormEvent, useEffect, useState } from "react";
import { api } from "../../api/client";
import { useFishVoices } from "../../hooks/useFishVoices";
import { useResolvedVrmUrl } from "../../hooks/useResolvedVrmUrl";
import { useVrmModels } from "../../hooks/useVrmModels";
import {
  defaultFishVoiceLabel,
  groupFishVoices,
  presenceFishVoiceId,
  selectVoiceValue,
} from "../../lib/fishVoices";
import { libraryVrmRef, parseLibraryVrmId } from "../../lib/vrmLibrary";
import { persistableVrmUrl } from "../../lib/resolveStoredVrmUrl";
import { VrmPreviewCanvas } from "../vrm/VrmPreviewCanvas";

type Presence = {
  vrm_url?: string | null;
  vrmUrl?: string | null;
  fish_voice_id?: string | null;
  fishVoiceId?: string | null;
};

type Props = {
  slug: string;
};

export function AgentAvatarVoiceEditor({ slug }: Props) {
  const { models, loading: modelsLoading, error: modelsError } = useVrmModels();
  const { voices, defaultVoiceId, fishConfigured, error: voicesError } = useFishVoices();
  const [vrmRef, setVrmRef] = useState("");
  const [fishVoiceId, setFishVoiceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const previewUrl = useResolvedVrmUrl(vrmRef);

  useEffect(() => {
    let cancelled = false;
    void api<{ presence: Presence | null }>(`/presence/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (cancelled) return;
        const p = r.presence;
        setVrmRef(persistableVrmUrl(p?.vrm_url || p?.vrmUrl || ""));
        setFishVoiceId(presenceFishVoiceId(p));
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load presence");
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/presence/${encodeURIComponent(slug)}`, {
        method: "PUT",
        body: JSON.stringify({
          vrm_url: persistableVrmUrl(vrmRef) || null,
          fish_voice_id: fishVoiceId || null,
        }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const selectedId = parseLibraryVrmId(vrmRef);
  const voiceGroups = groupFishVoices(voices);
  const voiceSelectValue = selectVoiceValue(fishVoiceId, defaultVoiceId);
  const voiceInCatalog = voices.some((v) => v.id === voiceSelectValue);

  return (
    <form className="card" onSubmit={(e) => void save(e)} style={{ marginTop: "1.5rem" }}>
      <h3>Avatar & voice</h3>
      <p className="muted">Default VRM from the library and Fish TTS voice for this agent instance.</p>
      {error ? <p className="badge bad">{error}</p> : null}
      {modelsError ? <p className="badge bad">{modelsError}</p> : null}

      <div className="split" style={{ marginTop: "1rem" }}>
        <div>
          <label>
            VRM model
            <select
              value={selectedId || ""}
              onChange={(e) => setVrmRef(e.target.value ? libraryVrmRef(e.target.value) : "")}
              disabled={!loaded || modelsLoading}
            >
              <option value="">None</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.source === "directory" ? " (dir)" : ""}
                  {m.missing ? " — missing file" : ""}
                </option>
              ))}
            </select>
          </label>
          <label style={{ marginTop: "0.75rem", display: "block" }}>
            Fish TTS voice
            <select value={voiceSelectValue} onChange={(e) => setFishVoiceId(e.target.value)}>
              <option value="">{defaultFishVoiceLabel(voices, defaultVoiceId)}</option>
              {voiceGroups.workspace.filter((v) => v.id !== defaultVoiceId).length ? (
                <optgroup label="Your voices">
                  {voiceGroups.workspace
                    .filter((v) => v.id !== defaultVoiceId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {voiceGroups.library.filter((v) => v.id !== defaultVoiceId).length ? (
                <optgroup label="Library">
                  {voiceGroups.library
                    .filter((v) => v.id !== defaultVoiceId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {voiceSelectValue && !voiceInCatalog ? (
                <option value={voiceSelectValue}>Current — {voiceSelectValue}</option>
              ) : null}
            </select>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              {fishConfigured === false
                ? "Set FISH_API_KEY on oc-controller to enable TTS."
                : voicesError || "Used when this agent speaks in chat."}
            </span>
          </label>
          <button type="submit" disabled={saving || !loaded} style={{ marginTop: "1rem" }}>
            {saving ? "Saving…" : "Save avatar & voice"}
          </button>
        </div>
        <div>
          {previewUrl ? (
            <VrmPreviewCanvas vrmUrl={previewUrl} height={280} />
          ) : (
            <p className="muted">Select a library VRM to preview.</p>
          )}
        </div>
      </div>
    </form>
  );
}
