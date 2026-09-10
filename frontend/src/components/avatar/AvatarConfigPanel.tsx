import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  listClothesFromVrmBuffer,
  listPresenceMoods,
  mergeAckGestureOptions,
  PRESENCE_MOODS,
  type ClothesPieceTransform,
  type CompanionHost,
} from "@openclaw/character-kit";
import { api } from "../../api/client";
import { readAgentAvatar, writeAgentAvatar } from "../../lib/agentAvatarStore";
import { persistableVrmUrl } from "../../lib/resolveStoredVrmUrl";
import type { CompanionSceneControlState } from "../../hooks/useCompanionSceneControls";
import {
  CLOTHES_DEFAULT_ID,
  CLOTHES_NONE_ID,
  CLOTHES_OVERLAY_CATALOG,
  VRM_CATALOG,
  catalogEntryByUrl,
} from "../../lib/vrmCatalog";
import { ClothesPieceConfig } from "./ClothesPieceConfig";
import { SceneControlsPanel } from "./SceneControlsPanel";
import { StatusMotionsConfig } from "./StatusMotionsConfig";
import {
  parseStatusMotions,
  serializeStatusMotions,
  type StatusMotionMap,
} from "../../lib/agentStatusGestures";
import {
  parseWalkTrailSettings,
  serializeWalkTrailSettings,
  type WalkTrailSettings,
  walkTrailOptionsFromSettings,
} from "../../lib/walkTrailSettings";
import {
  parseInteractionAckSettings,
  serializeInteractionAckSettings,
  type InteractionAckSettings,
} from "../../lib/interactionAckSettings";
import {
  isLipSyncEnabled,
  serializeLipSyncSettings,
} from "../../lib/lipSyncSettings";
import {
  readPresenceTtsSpeakModeOverride,
  serializePresenceTtsSpeakMode,
  type TtsSpeakModeOverride,
} from "../../lib/ttsSpeakMode";
import {
  defaultFishVoiceLabel,
  groupFishVoices,
  selectVoiceValue,
} from "../../lib/fishVoices";
import { useFishVoices } from "../../hooks/useFishVoices";
import { useVrmModels } from "../../hooks/useVrmModels";
import { libraryVrmRef, parseLibraryVrmId } from "../../lib/vrmLibrary";

const LOCO_NEARBY_KEY = "loco_nearby_radius_m";
const DEFAULT_LOCO_NEARBY = 8;

function parseLocoNearbyRadius(settings?: Record<string, unknown> | null): number {
  const raw = settings?.[LOCO_NEARBY_KEY];
  if (raw === undefined || raw === null) return DEFAULT_LOCO_NEARBY;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LOCO_NEARBY;
  return Math.max(0, Math.min(50, n));
}

export type ClothesOverlayItemSave = {
  sourceId: string;
  itemId: string;
  transform?: Partial<ClothesPieceTransform>;
};

export type AvatarClothesState = {
  clothesId?: string;
  clothesIds?: string[];
  clothesOverlayId?: string;
  clothesOverlayItems?: ClothesOverlayItemSave[];
};

export type AvatarPresencePatch = {
  vrm_url?: string | null;
  default_mood?: string | null;
  pointer_look?: boolean;
  fish_voice_id?: string | null;
  clothes?: AvatarClothesState;
  settings?: Record<string, unknown>;
};

export type AvatarLivePreview = {
  slug: string;
  vrmUrl: string;
  mood: string;
  pointerLook: boolean;
  clothes: AvatarClothesState;
  previewObjectUrl?: string | null;
  motionDebug?: boolean;
  settings?: Record<string, unknown>;
};

export type AvatarConfigPanelProps = {
  slug: string;
  /** When true, render the form immediately (embedded in viewport). */
  open?: boolean;
  onClose?: () => void;
  initialVrmUrl?: string;
  initialMood?: string;
  initialPointerLook?: boolean;
  initialFishVoiceId?: string;
  initialClothes?: AvatarClothesState | null;
  initialSettings?: Record<string, unknown> | null;
  compact?: boolean;
  onApplied?: (patch: AvatarPresencePatch & { objectUrl?: string }) => void;
  /** Fired on every draft change for live 3D preview (no persist). */
  onLiveChange?: (preview: AvatarLivePreview) => void;
  companionHost?: CompanionHost | null;
  sceneControls?: CompanionSceneControlState | null;
  sceneMood?: string;
  onSceneMoodChange?: (mood: string) => void;
  /** Drag handle for floating dialog — attach pointer handlers to the header. */
  onDragHandlePointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
};

const VRM_IDB = "oc-avatar-vrm";
const moods = listPresenceMoods().map((m) => m.id);

async function idbPut(key: string, blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VRM_IDB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("vrms");
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("vrms", "readwrite");
      tx.objectStore("vrms").put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

export async function idbGetVrm(slug: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(VRM_IDB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("vrms");
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("vrms")) {
        resolve(null);
        return;
      }
      const tx = db.transaction("vrms", "readonly");
      const get = tx.objectStore("vrms").get(slug);
      get.onsuccess = () => {
        const blob = get.result as Blob | undefined;
        resolve(blob ? URL.createObjectURL(blob) : null);
      };
      get.onerror = () => resolve(null);
    };
  });
}

/** Library-style avatar config for reuse (chat 3D, future UIs). */
export function AvatarConfigPanel({
  slug,
  open = true,
  onClose,
  initialVrmUrl = "",
  initialMood = "neutral",
  initialPointerLook = true,
  initialFishVoiceId = "",
  initialClothes,
  initialSettings,
  onApplied,
  onLiveChange,
  companionHost = null,
  sceneControls = null,
  sceneMood,
  onSceneMoodChange,
  onDragHandlePointerDown,
}: AvatarConfigPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { models: libraryModels } = useVrmModels();
  const [vrmUrl, setVrmUrl] = useState(initialVrmUrl);
  const libraryId = parseLibraryVrmId(initialVrmUrl);
  const [catalogId, setCatalogId] = useState(
    () => (libraryId ? `lib:${libraryId}` : catalogEntryByUrl(initialVrmUrl)?.id || ""),
  );
  const [mood, setMood] = useState(initialMood);
  const [pointerLook, setPointerLook] = useState(initialPointerLook);
  const [debugMood, setDebugMood] = useState(Boolean(initialSettings?.debug_mood));
  const [liveView, setLiveView] = useState(initialSettings?.live_view !== false);
  const [motionDebug, setMotionDebug] = useState(Boolean(initialSettings?.motion_debug));
  const [walkTrail, setWalkTrail] = useState<WalkTrailSettings>(() =>
    parseWalkTrailSettings(initialSettings),
  );
  const [interactionAck, setInteractionAck] = useState<InteractionAckSettings>(() =>
    parseInteractionAckSettings(initialSettings),
  );
  const [lipSyncEnabled, setLipSyncEnabled] = useState(() => isLipSyncEnabled(initialSettings));
  const [ttsSpeakMode, setTtsSpeakMode] = useState<TtsSpeakModeOverride>(() =>
    readPresenceTtsSpeakModeOverride(initialSettings),
  );
  const [locoNearbyRadius, setLocoNearbyRadius] = useState(() =>
    parseLocoNearbyRadius(initialSettings),
  );
  const [statusMotions, setStatusMotions] = useState<StatusMotionMap>(() =>
    parseStatusMotions(initialSettings),
  );
  const [fishVoiceId, setFishVoiceId] = useState(initialFishVoiceId);
  const { voices, defaultVoiceId, fishConfigured, error: voicesError } = useFishVoices();
  const [clothesId, setClothesId] = useState(initialClothes?.clothesId || CLOTHES_DEFAULT_ID);
  const [overlayId, setOverlayId] = useState(initialClothes?.clothesOverlayId || "");
  const [overlayItems, setOverlayItems] = useState<ClothesOverlayItemSave[]>(
    initialClothes?.clothesOverlayItems || [],
  );
  const [overlaySlots, setOverlaySlots] = useState<Array<{ id: string; label: string }>>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [localObjectUrl, setLocalObjectUrl] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState("");
  const skipLiveRef = useRef(true);
  const dirtyRef = useRef(false);

  useEffect(() => {
    skipLiveRef.current = true;
    setVrmUrl(initialVrmUrl);
    setCatalogId(catalogEntryByUrl(initialVrmUrl)?.id || "");
    setMood(initialMood);
    setPointerLook(initialPointerLook);
    setFishVoiceId(initialFishVoiceId);
    setClothesId(initialClothes?.clothesId || CLOTHES_DEFAULT_ID);
    setOverlayId(initialClothes?.clothesOverlayId || "");
    setOverlayItems(initialClothes?.clothesOverlayItems || []);
    setDebugMood(Boolean(initialSettings?.debug_mood));
    setLiveView(initialSettings?.live_view !== false);
    setMotionDebug(Boolean(initialSettings?.motion_debug));
    setWalkTrail(parseWalkTrailSettings(initialSettings));
    setInteractionAck(parseInteractionAckSettings(initialSettings));
    setLipSyncEnabled(isLipSyncEnabled(initialSettings));
    setTtsSpeakMode(readPresenceTtsSpeakModeOverride(initialSettings));
    setLocoNearbyRadius(parseLocoNearbyRadius(initialSettings));
    setStatusMotions(parseStatusMotions(initialSettings));
    setLocalObjectUrl(null);
    setUploadName("");
    setError("");
    dirtyRef.current = false;
    const t = window.setTimeout(() => {
      skipLiveRef.current = false;
    }, 0);
    return () => window.clearTimeout(t);
    // Re-hydrate only when switching agents or reopening. Live preview writes
    // the same fields back into parent state as new object identities and must
    // not clobber the in-progress catalog/URL draft (especially in group rooms).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [slug, open]);

  const moodOptions = useMemo(
    () =>
      moods.map((id) => ({
        id,
        hint: PRESENCE_MOODS[id as keyof typeof PRESENCE_MOODS]?.description || id,
      })),
    [],
  );

  const ackGestureOptions = useMemo(
    () =>
      mergeAckGestureOptions(companionHost?.listGestures() ?? [], [
        interactionAck.clickGesture,
        interactionAck.zoomInGesture,
        interactionAck.zoomOutGesture,
      ]),
    [
      companionHost,
      interactionAck.clickGesture,
      interactionAck.zoomInGesture,
      interactionAck.zoomOutGesture,
    ],
  );

  const voiceGroups = useMemo(() => groupFishVoices(voices), [voices]);
  const voiceSelectValue = selectVoiceValue(fishVoiceId, defaultVoiceId);
  const voiceInCatalog = useMemo(
    () => voices.some((v) => v.id === voiceSelectValue),
    [voices, voiceSelectValue],
  );

  useEffect(() => {
    if (!overlayId) {
      setOverlaySlots([]);
      return;
    }
    const entry = CLOTHES_OVERLAY_CATALOG.find((c) => c.id === overlayId);
    if (!entry) {
      setOverlaySlots([]);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    void fetch(entry.url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load overlay VRM (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) return;
        const items = listClothesFromVrmBuffer(buf);
        setOverlaySlots(
          items.map((item) => ({
            id: item.id,
            label: item.label || item.id,
          })),
        );
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("overlay clothes list failed", e);
        setOverlaySlots([]);
        setError(e instanceof Error ? e.message : "Failed to list overlay clothes");
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [overlayId]);

  useEffect(() => {
    if (!open || skipLiveRef.current) return;
    dirtyRef.current = true;
    if (!onLiveChange) return;
    const resolvedUrl =
      localObjectUrl ||
      (vrmUrl.startsWith("idb://") ? localObjectUrl || "" : vrmUrl) ||
      initialVrmUrl;
    onLiveChange({
      slug,
      vrmUrl: resolvedUrl,
      mood,
      pointerLook,
      clothes: {
        clothesId,
        clothesOverlayId: overlayId || undefined,
        clothesOverlayItems: overlayItems.length ? overlayItems : undefined,
      },
      previewObjectUrl: localObjectUrl,
      motionDebug,
      settings: {
        debug_mood: debugMood,
        live_view: liveView,
        motion_debug: motionDebug,
        status_motions: serializeStatusMotions(statusMotions),
        ...serializeWalkTrailSettings(walkTrail),
        ...serializeInteractionAckSettings(interactionAck),
        ...serializeLipSyncSettings(lipSyncEnabled),
        ...serializePresenceTtsSpeakMode(ttsSpeakMode),
        [LOCO_NEARBY_KEY]: locoNearbyRadius,
      },
    });
  }, [
    open,
    onLiveChange,
    slug,
    vrmUrl,
    mood,
    pointerLook,
    clothesId,
    overlayId,
    overlayItems,
    localObjectUrl,
    initialVrmUrl,
    motionDebug,
    debugMood,
    liveView,
    statusMotions,
    walkTrail,
    interactionAck,
    lipSyncEnabled,
    ttsSpeakMode,
    locoNearbyRadius,
  ]);

  useEffect(() => {
    if (!companionHost || skipLiveRef.current) return;
    companionHost.setWalkTrailOptions(
      walkTrailOptionsFromSettings(serializeWalkTrailSettings(walkTrail)),
    );
    companionHost.setLocoNearbyRadius(locoNearbyRadius);
    companionHost.setInteractionAck(interactionAck);
  }, [companionHost, walkTrail, locoNearbyRadius, interactionAck]);

  if (!open) return null;

  function buildPatch(vrmUrlOverride?: string): AvatarPresencePatch {
    const nextVrm = persistableVrmUrl(vrmUrlOverride !== undefined ? vrmUrlOverride : vrmUrl);
    const clothes: AvatarClothesState = {
      clothesId,
      clothesOverlayId: overlayId || undefined,
      clothesOverlayItems: overlayItems.length ? overlayItems : undefined,
    };
    return {
      ...(nextVrm ? { vrm_url: nextVrm } : {}),
      default_mood: mood,
      pointer_look: pointerLook,
      fish_voice_id: fishVoiceId || null,
      clothes,
      settings: {
        debug_mood: debugMood,
        live_view: liveView,
        motion_debug: motionDebug,
        status_motions: serializeStatusMotions(statusMotions),
        ...serializeWalkTrailSettings(walkTrail),
        ...serializeInteractionAckSettings(interactionAck),
        ...serializeLipSyncSettings(lipSyncEnabled),
        ...serializePresenceTtsSpeakMode(ttsSpeakMode),
        [LOCO_NEARBY_KEY]: locoNearbyRadius,
        local_vrm: Boolean(localObjectUrl) || Boolean(nextVrm.startsWith("idb://")),
        upload_name: uploadName || undefined,
        catalog_id: catalogId || catalogEntryByUrl(nextVrm)?.id || undefined,
      },
    };
  }

  async function persist(opts?: { close?: boolean; objectUrl?: string; vrmUrl?: string }) {
    const close = opts?.close !== false;
    const patch = buildPatch(opts?.vrmUrl);
    setSaving(true);
    setError("");
    try {
      await api(`/presence/${encodeURIComponent(slug)}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      const existing = readAgentAvatar(slug);
      writeAgentAvatar(slug, {
        vrm_url: persistableVrmUrl(patch.vrm_url) || existing?.vrm_url || "",
        default_mood: patch.default_mood || "neutral",
        pointer_look: patch.pointer_look !== false,
        fish_voice_id: patch.fish_voice_id || "",
        clothes: (patch.clothes || {}) as Record<string, unknown>,
        settings: patch.settings || {},
      });
      dirtyRef.current = false;
      onApplied?.({ ...patch, objectUrl: opts?.objectUrl });
      if (close) onClose?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save presence");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await persist({ close: true, objectUrl: localObjectUrl || undefined });
  }

  async function handleClose() {
    if (!dirtyRef.current) {
      onClose?.();
      return;
    }
    await persist({ close: true, objectUrl: localObjectUrl || undefined });
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    try {
      await idbPut(slug, file);
      if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
      const url = URL.createObjectURL(file);
      setLocalObjectUrl(url);
      setUploadName(file.name);
      setCatalogId("");
      setVrmUrl(`idb://${slug}`);
      setError("");
      dirtyRef.current = true;
      void persist({ close: false, vrmUrl: `idb://${slug}`, objectUrl: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to store VRM");
    }
  }

  function selectCatalog(id: string) {
    setCatalogId(id);
    setLocalObjectUrl(null);
    setUploadName("");
    if (!id) {
      setVrmUrl("");
      return;
    }
    if (id.startsWith("lib:")) {
      const libId = id.slice(4);
      const ref = libraryVrmRef(libId);
      setVrmUrl(ref);
      dirtyRef.current = true;
      void persist({ close: false, vrmUrl: ref });
      return;
    }
    const entry = VRM_CATALOG.find((e) => e.id === id);
    if (entry) {
      setVrmUrl(entry.url);
      dirtyRef.current = true;
      void persist({ close: false, vrmUrl: entry.url });
    }
  }

  function toggleOverlayItem(itemId: string, checked: boolean) {
    if (!overlayId) return;
    setOverlayItems((prev) => {
      const idx = prev.findIndex((p) => p.sourceId === overlayId && p.itemId === itemId);
      if (checked) {
        if (idx >= 0) return prev;
        return [...prev, { sourceId: overlayId, itemId }];
      }
      if (idx < 0) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }

  function setItemTransform(itemId: string, transform: Partial<ClothesPieceTransform> | undefined) {
    if (!overlayId) return;
    setOverlayItems((prev) =>
      prev.map((p) => {
        if (p.sourceId !== overlayId || p.itemId !== itemId) return p;
        if (!transform) {
          const { transform: _drop, ...rest } = p;
          return rest;
        }
        return { ...p, transform };
      }),
    );
  }

  return (
    <form className="avatar-config-panel card" onSubmit={(e) => void handleSubmit(e)}>
      <div
        className={`avatar-config-head ${onDragHandlePointerDown ? "avatar-config-drag" : ""}`}
        onPointerDown={onDragHandlePointerDown}
      >
        <strong>@{slug} avatar</strong>
        <button type="button" className="secondary" onClick={() => void handleClose()} disabled={saving}>
          {saving ? "Saving…" : "Close"}
        </button>
      </div>

      <label>
        Model
        <select value={catalogId} onChange={(e) => selectCatalog(e.target.value)}>
          <option value="">Custom / upload</option>
          {libraryModels.length ? (
            <optgroup label="Library">
              {libraryModels.map((m) => (
                <option key={m.id} value={`lib:${m.id}`}>
                  {m.name}
                  {m.source === "directory" ? " (dir)" : ""}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="dev-vrm catalog">
            {VRM_CATALOG.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <label>
        VRM URL
        <input
          value={vrmUrl.startsWith("idb://") ? "" : vrmUrl}
          onChange={(e) => {
            setLocalObjectUrl(null);
            setUploadName("");
            setCatalogId(catalogEntryByUrl(e.target.value)?.id || "");
            setVrmUrl(e.target.value);
            dirtyRef.current = true;
          }}
          placeholder="https://…/model.vrm or pick catalog"
        />
      </label>

      <div className="avatar-config-row">
        <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
          Upload VRM
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".vrm,model/gltf-binary,application/octet-stream"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            void handleFile(f);
            e.target.value = "";
          }}
        />
        {localObjectUrl || uploadName ? (
          <span className="badge ok">{uploadName || "Local VRM ready"}</span>
        ) : null}
      </div>

      <label>
        Native clothes
        <select value={clothesId} onChange={(e) => setClothesId(e.target.value)}>
          <option value={CLOTHES_NONE_ID}>None</option>
          <option value={CLOTHES_DEFAULT_ID}>Default</option>
        </select>
      </label>

      <label>
        Clothes overlay source
        <select
          value={overlayId}
          onChange={(e) => {
            setOverlayId(e.target.value);
            setExpandedItem(null);
          }}
        >
          <option value="">None</option>
          {CLOTHES_OVERLAY_CATALOG.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      {overlayId ? (
        <div className="avatar-overlay-slots">
          <strong className="muted">Overlay pieces</strong>
          {slotsLoading ? <p className="muted">Loading slots…</p> : null}
          {!slotsLoading && !overlaySlots.length ? (
            <p className="muted">No clothes slots found on this VRM.</p>
          ) : null}
          {overlaySlots.map((slot) => {
            const checked = overlayItems.some(
              (p) => p.sourceId === overlayId && p.itemId === slot.id,
            );
            const item = overlayItems.find((p) => p.sourceId === overlayId && p.itemId === slot.id);
            return (
              <div key={slot.id} className="avatar-overlay-slot">
                <label className="chat-avatar-toggle">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleOverlayItem(slot.id, e.target.checked)}
                  />
                  {slot.label}
                </label>
                {checked ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setExpandedItem((cur) => (cur === slot.id ? null : slot.id))}
                  >
                    {expandedItem === slot.id ? "Hide" : "Transform"}
                  </button>
                ) : null}
                {checked && expandedItem === slot.id ? (
                  <ClothesPieceConfig
                    value={item?.transform}
                    onChange={(t) => setItemTransform(slot.id, t)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <label>
        Mood
        <select value={mood} onChange={(e) => setMood(e.target.value)}>
          {moodOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
      </label>

      <label className="chat-avatar-toggle">
        <input type="checkbox" checked={debugMood} onChange={(e) => setDebugMood(e.target.checked)} />
        Mood debug
      </label>
      <label className="chat-avatar-toggle">
        <input type="checkbox" checked={liveView} onChange={(e) => setLiveView(e.target.checked)} />
        Live view
      </label>
      <label className="chat-avatar-toggle">
        <input
          type="checkbox"
          checked={motionDebug}
          onChange={(e) => setMotionDebug(e.target.checked)}
        />
        Motion debug feed
      </label>

      <fieldset className="chat-avatar-trail-fields">
        <legend>Click / zoom motion</legend>
        <label className="chat-avatar-toggle">
          <input
            type="checkbox"
            checked={interactionAck.clickEnabled}
            onChange={(e) =>
              setInteractionAck((a) => ({ ...a, clickEnabled: e.target.checked }))
            }
          />
          Nod on click
        </label>
        <label>
          Ack motion
          <select
            value={interactionAck.clickGesture}
            disabled={!interactionAck.clickEnabled}
            onChange={(e) =>
              setInteractionAck((a) => ({ ...a, clickGesture: e.target.value }))
            }
          >
            {ackGestureOptions.map((id) => (
              <option key={`click-${id}`} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ack speed ×{interactionAck.clickSpeed.toFixed(2)}
          <input
            type="range"
            min={0.35}
            max={2.5}
            step={0.05}
            value={interactionAck.clickSpeed}
            disabled={!interactionAck.clickEnabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              setInteractionAck((a) => ({
                ...a,
                clickSpeed: Number.isFinite(n) ? n : a.clickSpeed,
              }));
            }}
          />
        </label>
        <p className="muted chat-avatar-ack-hint">
          Page clicks nod (buttons/dialogs ignored). Orbit drags do not fire.
        </p>
        <label className="chat-avatar-toggle">
          <input
            type="checkbox"
            checked={interactionAck.zoomEnabled}
            onChange={(e) =>
              setInteractionAck((a) => ({ ...a, zoomEnabled: e.target.checked }))
            }
          />
          Gestures on zoom
        </label>
        <label>
          Zoom in
          <select
            value={interactionAck.zoomInGesture}
            disabled={!interactionAck.zoomEnabled}
            onChange={(e) =>
              setInteractionAck((a) => ({ ...a, zoomInGesture: e.target.value }))
            }
          >
            {ackGestureOptions.map((id) => (
              <option key={`zin-${id}`} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zoom out
          <select
            value={interactionAck.zoomOutGesture}
            disabled={!interactionAck.zoomEnabled}
            onChange={(e) =>
              setInteractionAck((a) => ({ ...a, zoomOutGesture: e.target.value }))
            }
          >
            {ackGestureOptions.map((id) => (
              <option key={`zout-${id}`} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <p className="muted chat-avatar-ack-hint">
          Defaults: v-sign in, wave out. Short V-sign: <code>v_sign_short</code>. Canvas wheel only.
        </p>
      </fieldset>

      <fieldset className="chat-avatar-trail-fields">
        <legend>Walk trail</legend>
        <label className="chat-avatar-toggle">
          <input
            type="checkbox"
            checked={walkTrail.enabled}
            onChange={(e) => setWalkTrail((t) => ({ ...t, enabled: e.target.checked }))}
          />
          Enabled
        </label>
        <label>
          Color
          <input
            type="color"
            value={walkTrail.color.startsWith("#") ? walkTrail.color.slice(0, 7) : "#ffffff"}
            onChange={(e) => setWalkTrail((t) => ({ ...t, color: e.target.value }))}
            disabled={!walkTrail.enabled}
          />
        </label>
        <label>
          Fade out (seconds)
          <input
            type="number"
            min={0.5}
            max={60}
            step={0.5}
            value={walkTrail.durationSec}
            disabled={!walkTrail.enabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              setWalkTrail((t) => ({
                ...t,
                durationSec: Number.isFinite(n) ? n : t.durationSec,
              }));
            }}
          />
        </label>
      </fieldset>

      <label>
        Nearby objects radius (m)
        <input
          type="number"
          min={0}
          max={50}
          step={0.5}
          value={locoNearbyRadius}
          title="Included in walk/turn tool results (0 = off)"
          onChange={(e) => {
            const n = Number(e.target.value);
            setLocoNearbyRadius(Number.isFinite(n) ? Math.max(0, Math.min(50, n)) : DEFAULT_LOCO_NEARBY);
          }}
        />
      </label>

      <StatusMotionsConfig motions={statusMotions} onChange={setStatusMotions} />

      <label>
        Fish TTS voice
        <select
          value={voiceSelectValue}
          onChange={(e) => setFishVoiceId(e.target.value)}
        >
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
        <span className="muted">
          {fishConfigured === false
            ? "Set FISH_API_KEY on oc-controller to enable TTS."
            : voicesError
              ? voicesError
              : "Used when speaking replies. Default is used if unset."}
        </span>
      </label>

      <label className="chat-avatar-toggle">
        <input
          type="checkbox"
          checked={lipSyncEnabled}
          onChange={(e) => setLipSyncEnabled(e.target.checked)}
        />
        Lip sync with TTS
      </label>
      <p className="muted chat-avatar-ack-hint">
        Mouth visemes follow speech. On by default; uncheck if a model fights the mouth shapes.
      </p>

      <label>
        Speak mode
        <select
          value={ttsSpeakMode}
          onChange={(e) =>
            setTtsSpeakMode(
              e.target.value === "auto" || e.target.value === "tool"
                ? e.target.value
                : "inherit",
            )
          }
        >
          <option value="inherit">Use workspace default</option>
          <option value="tool">Tool-based speak (recommended)</option>
          <option value="auto">Auto-speak full replies (legacy)</option>
        </select>
        <span className="muted">
          Tool mode: agent calls character_speak for short lines; long replies are printed only.
        </span>
      </label>

      {sceneControls ? (
        <SceneControlsPanel
          host={companionHost}
          mood={sceneMood || mood}
          onMoodChange={(m) => {
            setMood(m);
            onSceneMoodChange?.(m);
          }}
          controls={sceneControls}
          pointerLookOverride={pointerLook}
          onPointerLookOverride={setPointerLook}
        />
      ) : null}

      {error ? <span className="badge bad">{error}</span> : null}

      <div className="avatar-config-row">
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Apply & save"}
        </button>
      </div>
    </form>
  );
}
