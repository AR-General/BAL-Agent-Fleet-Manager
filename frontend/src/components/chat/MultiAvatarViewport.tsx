/**
 * Scene room powered by character-kit CompanionHost (same stack as dev-vrm playground).
 * Group shared layout: one SceneRoom with every participant in reserved spawn slots.
 * Group split layout: one CompanionHost widget per participant.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CompanionHost,
  SceneRoom,
  ACTION_FEED_MAX,
  LOCO_WALK_SPEED,
  preloadCharacterAssets,
  fetchRewrittenManifest,
  upsertActionEvent,
  type CharacterActionEvent,
  type ClothesOverlayPiece,
  type LoadedGestureInfo,
  type SceneOccupantPose,
} from "@nexus/character-kit";
import { useCompanionSceneControls } from "../../hooks/useCompanionSceneControls";
import { useWasdMoveInput } from "../../hooks/useWasdMoveInput";
import { api } from "../../api/client";
import { readAgentAvatar, writeAgentAvatar, type AgentAvatarSnapshot } from "../../lib/agentAvatarStore";
import { persistableVrmUrl, resolveStoredVrmUrl } from "../../lib/resolveStoredVrmUrl";
import { parseLibraryVrmId } from "../../lib/vrmLibrary";
import { useResolvedVrmMap } from "../../hooks/useResolvedVrmUrl";
import {
  formatStatusChip,
  parseStatusMotions,
  type AgentLiveStatus,
} from "../../lib/agentStatusGestures";
import { useAgentStatusMotions } from "../../hooks/useAgentStatusMotions";
import { ExpandableLabel } from "../common/ExpandableLabel";
import { useInlineTagPerformance } from "../../hooks/useInlineTagPerformance";
import { CLOTHES_OVERLAY_CATALOG, VRM_CATALOG } from "../../lib/vrmCatalog";
import { applyCompanionHostSettings } from "../../lib/companionHostSettings";
import { isLipSyncEnabled } from "../../lib/lipSyncSettings";
import { mergeAvatarLivePreview } from "../../lib/avatarLivePreview";
import { loadScenePoses, parseScenePoses, saveScenePoses } from "../../lib/scenePoseStorage";
import {
  AvatarConfigPanel,
  idbGetVrm,
  type AvatarClothesState,
  type AvatarLivePreview,
  type AvatarPresencePatch,
} from "../avatar/AvatarConfigPanel";
import { MotionDebugPopup } from "../avatar/MotionDebugPopup";
import { GestureTestPopup } from "../avatar/GestureTestPopup";
import { SceneDebugPopup } from "../avatar/SceneDebugPopup";
import { CompanionViewportCell } from "./CompanionViewportCell";
import { SharedGroupScene } from "./SharedGroupScene";
import { SceneVoiceDock } from "./SceneVoiceDock";
import type { TtsQueueState, TtsSpeakSource } from "../../hooks/useStreamingTts";
import { ViewportActionStack } from "./ViewportActionStack";
import type { ViewportToolEvent } from "../../lib/toolActionToasts";
import type { AgentPresence } from "../../lib/participantPresence";
import type { SceneGraphHost } from "../../lib/sceneGraphHost";
import { bridgeFromCompanion, createSceneGraphHost } from "../../lib/sceneGraphHost";
import type { SceneEntityDigest } from "@nexus/scene-kit";

type Props = {
  participantSlugs: string[];
  agentStatus?: AgentLiveStatus | null;
  toolEvents?: ViewportToolEvent[];
  sessionId?: string;
  collapsedChat?: ReactNode;
  ttsText?: string;
  ttsMessageId?: string;
  ttsStreaming?: boolean;
  /** Instance slug of the assistant currently being spoken. */
  ttsAuthorSlug?: string;
  /** Completed assistant message id — triggers inline [walk]/[mood] performance once. */
  performanceKey?: string | null;
  /** Full text of that completed assistant message (tags included). */
  performanceText?: string | null;
  voiceId?: string | null;
  onTranscript?: (text: string) => void;
  /** Group conversations: shared scene (default) or one 3D widget per participant. */
  sessionType?: string;
  presenceBySlug?: Record<string, AgentPresence>;
  onPresenceApplied?: (slug: string, patch: AvatarPresencePatch) => void;
  lookAtRequest?: { slug: string; token: number } | null;
  configRequest?: { slug: string; token: number } | null;
  ttsSources?: TtsSpeakSource[];
  onTtsQueueState?: (state: TtsQueueState) => void;
  onTtsControls?: (ctl: {
    cancelCurrent: () => void;
    cancelQueue: () => void;
    speakNow: (text: string, opts?: { slug?: string; messageId?: string; voiceId?: string }) => void;
    remapMessageId: (oldId: string, newId: string) => void;
  }) => void;
  workspaceSpeakMode?: import("../../lib/ttsSpeakMode").TtsSpeakMode;
  onWorkspaceSpeakModeChange?: (mode: import("../../lib/ttsSpeakMode").TtsSpeakMode) => void;
  /** Dedicated browser window for this scene — hide unpin/pop-out chrome. */
  popoutMode?: boolean;
  onPopOut?: () => void;
  onReturnToChat?: () => void;
};

type PresenceRecord = {
  vrmUrl?: string | null;
  vrm_url?: string | null;
  defaultMood?: string | null;
  default_mood?: string | null;
  pointerLook?: boolean | null;
  pointer_look?: boolean | null;
  fishVoiceId?: string | null;
  fish_voice_id?: string | null;
  clothes?: AvatarClothesState | null;
  settings?: Record<string, unknown> | null;
};

type PresenceResponse = {
  slug: string;
  presence?: PresenceRecord | null;
};

type ViewportAvatar = {
  slug: string;
  vrmUrl: string;
  mood: string;
  pointerLook: boolean;
  fishVoiceId: string;
  clothes: AvatarClothesState;
  settings: Record<string, unknown>;
};

function clothesFromUnknown(raw: unknown): AvatarClothesState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as AvatarClothesState;
}

function snapshotToViewportAvatar(slug: string, snap: AgentAvatarSnapshot | null, vrmUrl: string): ViewportAvatar {
  return {
    slug,
    vrmUrl,
    mood: snap?.default_mood || "neutral",
    pointerLook: snap?.pointer_look !== false,
    fishVoiceId: snap?.fish_voice_id || "",
    clothes: clothesFromUnknown(snap?.clothes),
    settings: snap?.settings || {},
  };
}

function presenceToSnapshot(presence: PresenceRecord | null | undefined): AgentAvatarSnapshot {
  return {
    vrm_url: persistableVrmUrl(presence?.vrmUrl ?? presence?.vrm_url),
    default_mood: presence?.defaultMood ?? presence?.default_mood ?? "neutral",
    pointer_look: presence?.pointerLook ?? presence?.pointer_look ?? true,
    fish_voice_id: presence?.fishVoiceId ?? presence?.fish_voice_id ?? "",
    clothes: clothesFromUnknown(presence?.clothes),
    settings: (presence?.settings && typeof presence.settings === "object" ? presence.settings : {}) as Record<
      string,
      unknown
    >,
  };
}

type SceneLayout = "shared" | "split";

const SAMPLE_VRM_URL = VRM_CATALOG.find((v) => v.id === "sample")?.url || VRM_CATALOG[0]!.url;
const GESTURE_MANIFEST_URL = "/dev-vrm-assets/vrma/manifest.json";
const LAYOUT_KEY = "oc-chat-scene-layout";
const MOTION_DEBUG_KEY = "oc-chat-motion-debug";
const MOTION_DEBUG_OPEN_KEY = "oc-chat-motion-debug-open";
const SCENE_DEBUG_OPEN_KEY = "oc-chat-scene-debug-open";

function readLocalFlag(key: string, fallback = false): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

type FloatPos = { x: number; y: number; w: number; h: number };

function overlayPiecesFromClothes(clothes?: AvatarClothesState | null): ClothesOverlayPiece[] {
  const items = clothes?.clothesOverlayItems || [];
  const out: ClothesOverlayPiece[] = [];
  for (const item of items) {
    const src =
      CLOTHES_OVERLAY_CATALOG.find((c) => c.id === item.sourceId)?.url ||
      VRM_CATALOG.find((c) => c.id === item.sourceId)?.url;
    if (!src) continue;
    out.push({
      sourceId: item.sourceId,
      sourceUrl: src,
      itemId: item.itemId,
      transform: item.transform,
    });
  }
  return out;
}

function clothesInput(clothes?: AvatarClothesState | null) {
  return {
    id: clothes?.clothesId || "default",
    ids: clothes?.clothesIds,
    overlayPieces: overlayPiecesFromClothes(clothes),
  };
}

function loadKey(avatar: ViewportAvatar): string {
  return `${avatar.slug}::${avatar.vrmUrl}`;
}

function resolveSpeakSlug(
  authorSlug: string | undefined,
  focusedSlug: string,
  avatars: ViewportAvatar[],
): string {
  if (authorSlug && avatars.some((a) => a.slug === authorSlug)) return authorSlug;
  if (focusedSlug && avatars.some((a) => a.slug === focusedSlug)) return focusedSlug;
  return avatars[0]?.slug || "";
}

function IconBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`kb-icon ${active ? "on" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SvgIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={d} />
    </svg>
  );
}

const ICONS = {
  gear: "M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.77 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.13.22.39.3.59.22l2.39-.96c.5.39 1.04.71 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.55 1.62-.94l2.39.96c.22.08.46 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z",
  pin: "M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z",
  unpin: "M14 4v6.2l1.4 1.4.6-.6V4h1V2H7v2h1v6l-.4.4 1.4 1.4L14 7.8V4h0zM4.3 3.6 3 4.9l7.2 7.2L9 14v2h5.2v6h1.6v-6H18v-.7l2.1 2.1 1.3-1.3L4.3 3.6z",
  fullscreen: "M7 14H5v5h5v-2H7v-3zm0-4h2V7h3V5H5v5h2zm10 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  exitFullscreen: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
  popOut: "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  returnToChat: "M19 7v4H5.83l3.58-3.59L8 6l-6 6 6 6 1.41-1.41L5.83 13H21V7z",
  shared: "M3 5h18v14H3V5zm2 2v10h14V7H5z",
  split: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
  debug:
    "M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5s-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z",
  scene:
    "M12 2L2 7l10 5 10-5-10-5zm0 9.5L4.5 7.8v4.4L12 16.5l7.5-4.3V7.8L12 11.5zM4.5 14.2v2.5L12 21l7.5-4.3v-2.5L12 18.7 4.5 14.2z",
};

export function MultiAvatarViewport({
  participantSlugs,
  agentStatus,
  toolEvents = [],
  sessionId,
  collapsedChat,
  ttsText,
  ttsMessageId,
  ttsStreaming,
  ttsAuthorSlug,
  performanceKey,
  performanceText,
  voiceId,
  onTranscript,
  sessionType,
  presenceBySlug = {},
  onPresenceApplied,
  lookAtRequest = null,
  configRequest = null,
  ttsSources,
  onTtsQueueState,
  onTtsControls,
  workspaceSpeakMode,
  onWorkspaceSpeakModeChange,
  popoutMode = false,
  onPopOut,
  onReturnToChat,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<CompanionHost | null>(null);
  const loadTokenRef = useRef(0);
  const loadedKeyRef = useRef<string>("");
  const dragRef = useRef<{ ox: number; oy: number; start: FloatPos } | null>(null);
  const configDragRef = useRef<{ ox: number; oy: number; startX: number; startY: number } | null>(
    null,
  );
  const motionDragRef = useRef<{ ox: number; oy: number; startX: number; startY: number } | null>(
    null,
  );
  const gestureTestDragRef = useRef<{
    ox: number;
    oy: number;
    startX: number;
    startY: number;
  } | null>(null);
  const sceneDebugDragRef = useRef<{
    ox: number;
    oy: number;
    startX: number;
    startY: number;
  } | null>(null);
  const avatarsRef = useRef<ViewportAvatar[]>([]);
  const splitHostsRef = useRef(new Map<string, CompanionHost>());
  const sharedRoomRef = useRef<SceneRoom | null>(null);
  const sceneHostRef = useRef<SceneGraphHost | null>(null);
  const toolSeenRef = useRef(new Map<string, string>());
  const ttsAuthorSlugRef = useRef(ttsAuthorSlug);
  const focusedSlugRef = useRef("");
  const layoutModeRef = useRef<"solo" | "split" | "shared">("solo");
  const lastLipSyncSlugRef = useRef("");
  const lastOccupantKeyRef = useRef("");
  const lastEntityKeyRef = useRef("");

  const [presenceLoading, setPresenceLoading] = useState(false);
  const [companionLoading, setCompanionLoading] = useState(false);
  const [error, setError] = useState("");
  const [pointerLook, setPointerLook] = useState(true);
  const [avatars, setAvatars] = useState<ViewportAvatar[]>([]);
  const libraryBlobs = useResolvedVrmMap(avatars.map((a) => a.vrmUrl));
  const resolveAvatarVrm = useCallback(
    (url: string) => {
      const persistable = persistableVrmUrl(url) || url;
      if (parseLibraryVrmId(persistable)) {
        return libraryBlobs[url] || libraryBlobs[persistable] || "";
      }
      return url;
    },
    [libraryBlobs],
  );
  const [focusedSlug, setFocusedSlug] = useState<string>("");
  const [walkSlug, setWalkSlug] = useState<string | null>(null);
  const [configSlug, setConfigSlug] = useState<string | null>(null);
  const [configPos, setConfigPos] = useState({ x: 24, y: 72 });
  const [fullscreen, setFullscreen] = useState(false);
  const [unpinned, setUnpinned] = useState(false);
  const [floatPos, setFloatPos] = useState<FloatPos>({ x: 48, y: 72, w: 480, h: 420 });
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [hostReady, setHostReady] = useState(0);
  const [mood, setMood] = useState("neutral");
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    try {
      return localStorage.getItem("oc-chat-voice-tts") === "1";
    } catch {
      return false;
    }
  });
  const [ttsPlayingSlug, setTtsPlayingSlug] = useState<string | null>(null);
  const [motionDebugEnabled, setMotionDebugEnabled] = useState(() =>
    readLocalFlag(MOTION_DEBUG_KEY, false),
  );
  const [motionDebugOpen, setMotionDebugOpen] = useState(() =>
    readLocalFlag(MOTION_DEBUG_KEY, false) && readLocalFlag(MOTION_DEBUG_OPEN_KEY, false),
  );
  const [motionDebugPos, setMotionDebugPos] = useState({ x: 48, y: 120 });
  const [motionEvents, setMotionEvents] = useState<CharacterActionEvent[]>([]);
  const [gestureTestOpen, setGestureTestOpen] = useState(false);
  const [gestureTestPos, setGestureTestPos] = useState({ x: 500, y: 120 });
  const [sceneDebugOpen, setSceneDebugOpen] = useState(() =>
    readLocalFlag(SCENE_DEBUG_OPEN_KEY, false),
  );
  const [sceneDebugPos, setSceneDebugPos] = useState({ x: 48, y: 280 });
  const [sceneHost, setSceneHost] = useState<SceneGraphHost | null>(null);
  const [splitHostGen, setSplitHostGen] = useState(0);
  const [sharedRoomGen, setSharedRoomGen] = useState(0);
  const [layout, setLayout] = useState<SceneLayout>(() => {
    try {
      const v = localStorage.getItem(LAYOUT_KEY);
      return v === "split" ? "split" : "shared";
    } catch {
      return "shared";
    }
  });
  const [savedPoses, setSavedPoses] = useState<SceneOccupantPose[]>([]);
  const [posesReady, setPosesReady] = useState(false);

  avatarsRef.current = avatars;

  const vrmUrlsKey = avatars.map((a) => a.vrmUrl).join("|");
  useEffect(() => {
    const urls = avatarsRef.current
      .map((a) => a.vrmUrl)
      .filter((url) => url && !url.startsWith("blob:") && !url.startsWith("data:") && !parseLibraryVrmId(url));
    void preloadCharacterAssets(urls);
    void fetchRewrittenManifest(GESTURE_MANIFEST_URL).catch(() => undefined);
  }, [vrmUrlsKey]);

  const normalizedSlugs = useMemo(
    () => participantSlugs.map((slug) => slug.trim()).filter(Boolean),
    [participantSlugs],
  );
  const isGroup = sessionType === "group" || normalizedSlugs.length > 1 || avatars.length > 1;
  const useSplit = isGroup && layout === "split";
  const useSharedRoom = isGroup && !useSplit;
  ttsAuthorSlugRef.current = ttsAuthorSlug;
  focusedSlugRef.current = focusedSlug;
  layoutModeRef.current = useSplit ? "split" : useSharedRoom ? "shared" : "solo";

  const hostForControls = useSplit || useSharedRoom ? null : hostReady > 0 ? hostRef.current : null;
  const sceneControls = useCompanionSceneControls(hostForControls, {
    actionFeedEnabled: Boolean(configSlug),
  });

  useEffect(() => {
    if (!normalizedSlugs.length) {
      setFocusedSlug("");
      setWalkSlug(null);
      return;
    }
    setFocusedSlug((prev) => (prev && normalizedSlugs.includes(prev) ? prev : normalizedSlugs[0]!));
    setWalkSlug((prev) => (prev && normalizedSlugs.includes(prev) ? prev : null));
  }, [normalizedSlugs]);

  const selectWalkSlug = useCallback((slug: string) => {
    setFocusedSlug(slug);
    setWalkSlug(slug);
  }, []);

  const applySelectedWasd = useCallback(
    (input: MoveInput) => {
      if (!walkSlug) return;
      if (useSharedRoom) {
        const handle = sharedRoomRef.current?.getAvatar(walkSlug);
        handle?.controller.setAnalogSpeed(LOCO_WALK_SPEED);
        handle?.controller.setMoveInput(input);
        return;
      }
      if (useSplit) {
        const host = splitHostsRef.current.get(walkSlug);
        host?.setAnalogSpeed(LOCO_WALK_SPEED);
        host?.setMoveInput(input);
      }
    },
    [walkSlug, useSharedRoom, useSplit],
  );
  useWasdMoveInput(applySelectedWasd, Boolean(walkSlug) && (useSplit || useSharedRoom));

  useEffect(() => {
    if (!lookAtRequest?.slug) return;
    selectWalkSlug(lookAtRequest.slug);
  }, [lookAtRequest?.slug, lookAtRequest?.token, selectWalkSlug]);

  useEffect(() => {
    if (!configRequest?.slug) return;
    selectWalkSlug(configRequest.slug);
    setConfigSlug(configRequest.slug);
  }, [configRequest?.slug, configRequest?.token, selectWalkSlug]);

  const postOccupants = useCallback(
    (poses: SceneOccupantPose[]) => {
      if (!sessionId) return;
      const key = poses
        .map((o) => `${o.slug}:${o.present ? 1 : 0}:${o.x.toFixed(1)}:${o.z.toFixed(1)}:${o.facing.toFixed(1)}`)
        .join("|");
      let entities: SceneEntityDigest[] | undefined;
      let entityKey = lastEntityKeyRef.current;
      try {
        const digest = sceneHostRef.current?.digest() || [];
        entityKey = digest
          .map((e) => `${e.id}:${e.kind}:${e.x.toFixed(1)}:${e.z.toFixed(1)}:${e.yaw.toFixed(1)}`)
          .join("|");
        if (entityKey !== lastEntityKeyRef.current) {
          entities = digest;
        }
      } catch {
        /* host optional */
      }
      if (key === lastOccupantKeyRef.current && entities === undefined) return;
      lastOccupantKeyRef.current = key;
      if (entities !== undefined) lastEntityKeyRef.current = entityKey;
      if (layoutModeRef.current === "shared") {
        saveScenePoses(sessionId, poses);
      }
      const body: Record<string, unknown> = { active: true, occupants: poses };
      if (entities !== undefined) body.entities = entities;
      void api(`/chat/sessions/${sessionId}/viewport`, {
        method: "PUT",
        body: JSON.stringify(body),
      }).catch((error) => {
        console.warn("Failed to sync scene occupants", error);
      });
    },
    [sessionId],
  );

  /** Periodic entity digest even when avatars are idle. */
  useEffect(() => {
    if (!sessionId || useSplit) return;
    if (!useSharedRoom && layoutModeRef.current !== "solo") return;
    const tick = () => {
      const host = sceneHostRef.current;
      if (!host) return;
      try {
        const digest = host.digest();
        const entityKey = digest
          .map((e) => `${e.id}:${e.kind}:${e.x.toFixed(1)}:${e.z.toFixed(1)}:${e.yaw.toFixed(1)}`)
          .join("|");
        if (entityKey === lastEntityKeyRef.current) return;
        lastEntityKeyRef.current = entityKey;
        void api(`/chat/sessions/${sessionId}/viewport`, {
          method: "PUT",
          body: JSON.stringify({ active: true, entities: digest }),
        }).catch((error) => {
          console.warn("Failed to sync scene entities", error);
        });
      } catch {
        /* ignore */
      }
    };
    const timer = window.setInterval(tick, 1500);
    return () => window.clearInterval(timer);
  }, [sessionId, useSharedRoom, useSplit, sharedRoomGen, hostReady]);

  useEffect(() => {
    lastOccupantKeyRef.current = "";
    lastEntityKeyRef.current = "";
    toolSeenRef.current.clear();
    if (!sessionId) {
      setSavedPoses([]);
      setPosesReady(false);
      return;
    }
    setPosesReady(false);
    const local = loadScenePoses(sessionId);
    if (local.length) {
      setSavedPoses(local);
      setPosesReady(true);
      console.info("[scene-poses] restored from localStorage", { sessionId, count: local.length });
      return;
    }
    setSavedPoses([]);
    let cancelled = false;
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 2500);
    void api<{ occupants?: unknown }>(`/chat/sessions/${sessionId}/viewport`, { signal: ac.signal })
      .then((data) => {
        if (cancelled) return;
        const poses = parseScenePoses(data?.occupants);
        setSavedPoses(poses);
        if (poses.length) {
          saveScenePoses(sessionId, poses);
          console.info("[scene-poses] restored from server", { sessionId, count: poses.length });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn("[scene-poses] GET failed", sessionId, err);
      })
      .finally(() => {
        if (!cancelled) setPosesReady(true);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!useSplit || !sessionId) return;
    const tick = () => {
      const poses: SceneOccupantPose[] = avatarsRef.current.map((avatar) => {
        const snap = splitHostsRef.current.get(avatar.slug)?.controller.getLocomotionSnapshot();
        return {
          slug: avatar.slug,
          x: snap?.x ?? 0,
          z: snap?.z ?? 0,
          facing: snap?.facing ?? 0,
          present: Boolean(snap),
        };
      });
      postOccupants(poses);
    };
    tick();
    const timer = window.setInterval(tick, 1500);
    return () => window.clearInterval(timer);
  }, [postOccupants, useSplit, avatars.length]);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      /* ignore */
    }
  }, [layout]);

  useEffect(() => {
    if (useSplit || useSharedRoom) {
      loadTokenRef.current += 1;
      hostRef.current?.dispose();
      hostRef.current = null;
      loadedKeyRef.current = "";
      setError("");
      return;
    }
    if (!canvasRef.current) return;
    loadedKeyRef.current = "";
    const slug = focusedSlug || participantSlugs[0] || "";
    const host = new CompanionHost(canvasRef.current, {
      background: 0x12171c,
      orbitControls: true,
      pointerLook: true,
      agentId: slug || undefined,
    });
    hostRef.current = host;
    setHostReady((v) => v + 1);

    const ro = new ResizeObserver(() => host.resize());
    if (canvasRef.current.parentElement) ro.observe(canvasRef.current.parentElement);

    return () => {
      loadTokenRef.current += 1;
      ro.disconnect();
      host.dispose();
      hostRef.current = null;
      loadedKeyRef.current = "";
    };
  }, [fullscreen, unpinned, useSplit, useSharedRoom]);

  /** Solo DM: attach SceneGraphHost to CompanionHost Three scene. */
  useEffect(() => {
    if (useSplit || useSharedRoom || !sessionId || hostReady < 1) {
      return;
    }
    const companion = hostRef.current;
    if (!companion) return;
    let cancelled = false;
    let host: SceneGraphHost | null = null;
    try {
      host = createSceneGraphHost({
        bridge: bridgeFromCompanion(companion, focusedSlug || participantSlugs[0]),
        sessionId,
      });
    } catch (err) {
      console.warn("[scene-host] solo create failed", err);
      host = null;
    }
    if (cancelled) {
      host?.dispose();
      return;
    }
    sceneHostRef.current = host;
    setSceneHost(host);

    let raf = 0;
    const loop = () => {
      try {
        sceneHostRef.current?.tick();
      } catch {
        /* ignore */
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !sceneHostRef.current) return;
      try {
        const id = sceneHostRef.current.pick(e.clientX, e.clientY);
        if (id) sceneHostRef.current.setSelected(id);
      } catch {
        /* ignore */
      }
    };
    const canvas = companion.controller.renderer?.domElement;
    canvas?.addEventListener("pointerdown", onPointerDown);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      canvas?.removeEventListener("pointerdown", onPointerDown);
      try {
        host?.dispose();
      } catch {
        /* ignore */
      }
      if (sceneHostRef.current === host) {
        sceneHostRef.current = null;
        setSceneHost(null);
      }
    };
  }, [hostReady, sessionId, useSplit, useSharedRoom, focusedSlug, participantSlugs]);

  const loadFocused = useCallback(async (avatar: ViewportAvatar, force = false) => {
    const host = hostRef.current;
    if (!host) return;

    const vrmUrl = resolveAvatarVrm(avatar.vrmUrl);
    if (!vrmUrl) return;

    const key = loadKey({ ...avatar, vrmUrl });
    if (!force && loadedKeyRef.current === key) {
      host.setPointerLookEnabled(avatar.pointerLook);
      host.getPresence().setMood(avatar.mood);
      applyCompanionHostSettings(host, avatar.settings);
      setMood(avatar.mood);
      setPointerLook(avatar.pointerLook);
      void host.setClothes(clothesInput(avatar.clothes));
      return;
    }

    const token = ++loadTokenRef.current;
    setCompanionLoading(true);
    setError("");
    try {
      await host.load({
        vrmUrl,
        gestureManifestUrl: GESTURE_MANIFEST_URL,
        mood: avatar.mood,
        clothes: clothesInput(avatar.clothes),
        pointerLook: avatar.pointerLook,
      });
      if (token !== loadTokenRef.current) return;
      loadedKeyRef.current = key;
      applyCompanionHostSettings(host, avatar.settings);
      setMood(avatar.mood);
      setPointerLook(avatar.pointerLook);
    } catch (e) {
      if (token !== loadTokenRef.current) return;
      const msg = e instanceof Error ? e.message : "Failed to load avatar";
      if (/disposed/i.test(msg)) {
        console.warn("CompanionHost load aborted after dispose", avatar.slug);
        return;
      }
      console.error("CompanionHost load failed", e);
      setError(msg);
      loadedKeyRef.current = "";
    } finally {
      if (token === loadTokenRef.current) setCompanionLoading(false);
    }
  }, [resolveAvatarVrm]);

  useEffect(() => {
    if (!normalizedSlugs.length) {
      setAvatars([]);
      return;
    }

    setAvatars(
      normalizedSlugs.map((slug) => {
        const cached = readAgentAvatar(slug);
        const cachedUrl = persistableVrmUrl(cached?.vrm_url);
        const displayUrl = cachedUrl.startsWith("idb://") ? SAMPLE_VRM_URL : cachedUrl || SAMPLE_VRM_URL;
        return snapshotToViewportAvatar(slug, cached, displayUrl);
      }),
    );

    let cancelled = false;

    async function healPresence(slug: string, cached: AgentAvatarSnapshot) {
      try {
        await api(`/presence/${encodeURIComponent(slug)}`, {
          method: "PUT",
          body: JSON.stringify({
            vrm_url: cached.vrm_url,
            default_mood: cached.default_mood,
            pointer_look: cached.pointer_look,
            fish_voice_id: cached.fish_voice_id || null,
            clothes: cached.clothes,
            settings: cached.settings,
          }),
        });
      } catch (healErr) {
        console.warn(`Failed to heal avatar presence for ${slug}`, healErr);
      }
    }

    async function loadPresence() {
      setPresenceLoading(true);
      try {
        const next = await Promise.all(
          normalizedSlugs.map(async (slug): Promise<ViewportAvatar> => {
            const cached = readAgentAvatar(slug);
            let remote: PresenceRecord | null = null;
            try {
              const response = await api<PresenceResponse>(`/presence/${encodeURIComponent(slug)}`);
              remote = response.presence ?? null;
            } catch (err) {
              console.warn(`Failed to load avatar presence for ${slug}`, err);
            }
            const remoteSnap = presenceToSnapshot(remote);
            const storedUrl = persistableVrmUrl(remoteSnap.vrm_url);
            const cachedUrl = persistableVrmUrl(cached?.vrm_url);
            if (storedUrl) writeAgentAvatar(slug, remoteSnap);
            else if (cached && cachedUrl) {
              void healPresence(slug, cached);
            }
            const snap = storedUrl ? remoteSnap : cached || remoteSnap;
            const idbObjectUrl = await idbGetVrm(slug);
            const vrmUrl = resolveStoredVrmUrl({
              storedUrl: snap.vrm_url,
              cachedUrl,
              idbObjectUrl,
              fallback: SAMPLE_VRM_URL,
            });
            return snapshotToViewportAvatar(slug, snap, vrmUrl);
          }),
        );
        if (cancelled) return;
        setAvatars(next);
      } catch (e) {
        if (cancelled) return;
        setAvatars(
          normalizedSlugs.map((slug) => {
            const cached = readAgentAvatar(slug);
            const cachedUrl = persistableVrmUrl(cached?.vrm_url);
            const displayUrl = cachedUrl.startsWith("idb://") ? SAMPLE_VRM_URL : cachedUrl || SAMPLE_VRM_URL;
            return snapshotToViewportAvatar(slug, cached, displayUrl);
          }),
        );
        setError(e instanceof Error ? e.message : "Failed to load presence");
      } finally {
        if (!cancelled) setPresenceLoading(false);
      }
    }

    void loadPresence();
    return () => {
      cancelled = true;
    };
  }, [normalizedSlugs]);

  const focusedAvatar = useMemo(
    () => avatars.find((a) => a.slug === focusedSlug),
    [avatars, focusedSlug],
  );
  const focusedLoadKey = focusedAvatar ? loadKey(focusedAvatar) : "";
  const motionDebugOn = motionDebugEnabled;
  const statusMotions = useMemo(
    () => parseStatusMotions(focusedAvatar?.settings),
    [focusedAvatar?.settings],
  );
  const hostForMotions = !useSplit && !useSharedRoom && hostReady > 0 ? hostRef.current : null;

  const listTestGestures = useCallback((): LoadedGestureInfo[] => {
    if (useSharedRoom) {
      const slug = walkSlug || focusedSlug;
      return sharedRoomRef.current?.getAvatar(slug)?.controller.listLoadedGestures() ?? [];
    }
    if (useSplit) {
      const slug = walkSlug || focusedSlug;
      return splitHostsRef.current.get(slug)?.listLoadedGestures() ?? [];
    }
    return hostRef.current?.listLoadedGestures() ?? [];
  }, [useSharedRoom, useSplit, focusedSlug, walkSlug, hostReady, splitHostGen, sharedRoomGen]);

  const playTestGesture = useCallback(
    (id: string, loop: boolean) => {
      const slug = walkSlug || focusedSlug;
      if (useSharedRoom) {
        const handle = sharedRoomRef.current?.getAvatar(slug);
        if (!handle) return;
        const result = handle.controller.playGesture(id, loop, 0.25, undefined, "user");
        if (result === "skipped") return;
        handle.director.pushAction("gesture", loop ? `${id} · loop` : id, "user", "test", undefined, {
          durationMs: handle.controller.gesturePlaybackMs(id, { loop }) ?? undefined,
          loop,
        });
        return;
      }
      const host = useSplit ? splitHostsRef.current.get(slug) : hostRef.current;
      host?.playGesture(id, loop, "user", "test");
    },
    [useSharedRoom, useSplit, focusedSlug, walkSlug],
  );

  const playingTestId = useMemo(() => {
    const ev = motionEvents.find((e) => e.status === "playing" && e.op === "gesture");
    return ev?.label.replace(/\s*·\s*loop$/i, "").trim() || null;
  }, [motionEvents]);

  const openGestureTester = useCallback(() => {
    setGestureTestPos({
      x: Math.min(window.innerWidth - 360, motionDebugPos.x + 456),
      y: motionDebugPos.y,
    });
    setGestureTestOpen(true);
  }, [motionDebugPos.x, motionDebugPos.y]);

  useEffect(() => {
    try {
      localStorage.setItem(MOTION_DEBUG_KEY, motionDebugEnabled ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [motionDebugEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(MOTION_DEBUG_OPEN_KEY, motionDebugOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [motionDebugOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(SCENE_DEBUG_OPEN_KEY, sceneDebugOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sceneDebugOpen]);

  /** Feed tool_call / tool_progress into agent-tools viz (shared + solo). */
  useEffect(() => {
    const host = sceneHost;
    if (!host || useSplit) return;
    for (const ev of toolEvents) {
      const tool = (ev.tool || ev.label || "").trim();
      if (!tool) continue;
      const id = ev.id || `${ev.authorSlug || ""}:${tool}`;
      const statusRaw = (ev.status || "start").toLowerCase();
      const status =
        statusRaw === "done" || statusRaw === "end" || statusRaw === "ok"
          ? "end"
          : statusRaw === "progress" || statusRaw === "running"
            ? "progress"
            : "start";
      const seen = toolSeenRef.current.get(id);
      if (seen === status) continue;
      const prev = seen;
      toolSeenRef.current.set(id, status);
      try {
        if (status === "start" || !prev) {
          host.handleToolEvent({
            tool,
            status: "start",
            agent: ev.authorSlug || focusedSlug || participantSlugs[0],
            toolCallId: id,
          });
        }
        if (status === "progress") {
          host.handleToolEvent({
            tool,
            status: "progress",
            agent: ev.authorSlug || focusedSlug || participantSlugs[0],
            toolCallId: id,
          });
        }
        if (status === "end") {
          host.handleToolEvent({
            tool,
            status: "end",
            agent: ev.authorSlug || focusedSlug || participantSlugs[0],
            toolCallId: id,
          });
        }
      } catch (err) {
        console.warn("[scene-host] tool event failed", err);
      }
    }
  }, [toolEvents, sceneHost, useSplit, focusedSlug, participantSlugs]);

  useEffect(() => {
    if (!motionDebugOn) {
      setMotionDebugOpen(false);
      setGestureTestOpen(false);
    }
  }, [motionDebugOn]);

  useEffect(() => {
    if (!motionDebugOn) return;
    const push = (ev: CharacterActionEvent) => {
      setMotionEvents((prev) => upsertActionEvent(prev, ev, ACTION_FEED_MAX));
    };
    const offs: Array<() => void> = [];
    if (useSharedRoom) {
      const room = sharedRoomRef.current;
      if (room) offs.push(room.onAction(push));
    } else if (useSplit) {
      for (const host of splitHostsRef.current.values()) {
        offs.push(host.onAction(push));
      }
    } else {
      const host = hostRef.current;
      if (host) offs.push(host.onAction(push));
    }
    return () => {
      for (const off of offs) off();
    };
  }, [hostReady, motionDebugOn, useSplit, useSharedRoom, splitHostGen, sharedRoomGen]);

  useEffect(() => {
    if (useSplit || useSharedRoom || !focusedAvatar || !hostRef.current) return;
    void loadFocused(focusedAvatar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedLoadKey, hostReady, loadFocused, useSplit, useSharedRoom]);

  const tagPerforming = useInlineTagPerformance({
    host: hostForMotions,
    performanceKey,
    performanceText,
    enabled: !useSplit && !useSharedRoom && !companionLoading && Boolean(hostForMotions?.getLoadedUrl()),
    ttsEnabled,
    onMood: setMood,
  });

  const playTimedSteps = useCallback(
    (steps: import("@nexus/character-kit").InlineSequenceStep[]) => {
      if (!steps.length) return;
      const nextAvatars = avatarsRef.current;
      const slug = resolveSpeakSlug(ttsAuthorSlugRef.current, focusedSlugRef.current, nextAvatars);
      const mode = layoutModeRef.current;
      const run = (label: string, task: Promise<unknown> | undefined) => {
        void task?.catch((err) => {
          console.warn("[tts] playTimedSteps failed", label, err);
        });
      };
      if (mode === "shared") {
        if (!slug) return;
        run(slug, sharedRoomRef.current?.playTimedSteps(slug, steps));
        return;
      }
      if (mode === "split") {
        if (!slug) return;
        run(slug, splitHostsRef.current.get(slug)?.playTimedSteps(steps));
        return;
      }
      run("solo", hostRef.current?.playTimedSteps(steps));
    },
    [],
  );

  const stopLipSyncFor = useCallback((slug?: string) => {
    const mode = layoutModeRef.current;
    const stopHost = (host: CompanionHost | null | undefined) => {
      host?.controller.getLipSync()?.stop();
    };
    if (mode === "shared") {
      const room = sharedRoomRef.current;
      if (!room) return;
      if (slug) {
        room.getAvatar(slug)?.controller.getLipSync()?.stop();
        return;
      }
      for (const avatar of avatarsRef.current) {
        room.getAvatar(avatar.slug)?.controller.getLipSync()?.stop();
      }
      return;
    }
    if (mode === "split") {
      if (slug) {
        stopHost(splitHostsRef.current.get(slug));
        return;
      }
      for (const host of splitHostsRef.current.values()) stopHost(host);
      return;
    }
    stopHost(hostRef.current);
  }, []);

  const applyPlaybackStream = useCallback(
    (stream: MediaStream | null, audioContext: AudioContext) => {
      const nextAvatars = avatarsRef.current;
      const slug = resolveSpeakSlug(ttsAuthorSlugRef.current, focusedSlugRef.current, nextAvatars);
      const prev = lastLipSyncSlugRef.current;
      if (prev && prev !== slug) stopLipSyncFor(prev);
      lastLipSyncSlugRef.current = stream && slug ? slug : "";

      if (!slug) return;
      const avatar = nextAvatars.find((a) => a.slug === slug);
      if (avatar && !isLipSyncEnabled(avatar.settings)) {
        console.info("[tts] lip-sync disabled for", slug);
        stopLipSyncFor(slug);
        return;
      }
      if (!stream) {
        stopLipSyncFor(slug);
        return;
      }

      const mode = layoutModeRef.current;
      const controller =
        mode === "shared"
          ? sharedRoomRef.current?.getAvatar(slug)?.controller
          : mode === "split"
            ? splitHostsRef.current.get(slug)?.controller
            : hostRef.current?.controller;
      if (!controller) {
        console.warn("[tts] lip-sync: no host for", slug, mode);
        return;
      }
      void (async () => {
        try {
          const lip = await controller.ensureLipSync(audioContext);
          await lip.useStream(stream);
          console.info("[tts] lip-sync attached", slug);
        } catch (err) {
          console.warn("[tts] lip-sync attach failed", err);
        }
      })();
    },
    [stopLipSyncFor],
  );

  const prepareLipSync = useCallback((audioContext: AudioContext) => {
    void (async () => {
      if (audioContext.state === "closed") {
        console.warn("[tts] lip-sync prepare skipped: AudioContext closed");
        return;
      }
      if (audioContext.state !== "running") {
        try {
          await audioContext.resume();
        } catch (err) {
          console.warn("[tts] AudioContext resume failed", err);
          return;
        }
      }
      const nextAvatars = avatarsRef.current;
      const mode = layoutModeRef.current;
      const rows: { label: string; controller: { ensureLipSync: (ctx?: AudioContext) => Promise<unknown> } }[] = [];
      const push = (
        label: string,
        controller: { ensureLipSync: (ctx?: AudioContext) => Promise<unknown> } | null | undefined,
      ) => {
        if (!controller) return;
        rows.push({ label, controller });
      };
      if (mode === "shared") {
        const room = sharedRoomRef.current;
        if (!room) return;
        for (const avatar of nextAvatars) {
          if (!isLipSyncEnabled(avatar.settings)) continue;
          push(avatar.slug, room.getAvatar(avatar.slug)?.controller);
        }
      } else if (mode === "split") {
        for (const [slug, host] of splitHostsRef.current) {
          const avatar = nextAvatars.find((a) => a.slug === slug);
          if (avatar && !isLipSyncEnabled(avatar.settings)) continue;
          push(slug, host.controller);
        }
      } else {
        push("solo", hostRef.current?.controller);
      }
      const speaker = ttsAuthorSlugRef.current;
      const ordered = speaker
        ? [...rows.filter((row) => row.label === speaker), ...rows.filter((row) => row.label !== speaker)]
        : rows;
      for (const row of ordered) {
        try {
          await row.controller.ensureLipSync(audioContext);
        } catch (err) {
          console.warn("[tts] lip-sync prepare failed", row.label, err);
        }
      }
    })();
  }, []);

  const expressionNames = (() => {
    try {
      if (!hostForMotions?.getLoadedUrl()) return undefined;
      return hostForMotions.inlineTagCatalog().expressions;
    } catch {
      return undefined;
    }
  })();

  useAgentStatusMotions({
    host: hostForMotions,
    agentStatus,
    motions: statusMotions,
    enabled: !useSplit && !useSharedRoom && !tagPerforming,
    focusedSlug,
    onMood: setMood,
  });

  const applyLivePreview = useCallback(
    (preview: AvatarLivePreview) => {
      const host = hostRef.current;
      if (preview.slug !== focusedSlug && !useSplit && !useSharedRoom) return;

      const nextUrl = preview.previewObjectUrl || preview.vrmUrl;
      const soloUrlChanged = Boolean(
        host && !useSplit && !useSharedRoom && nextUrl && nextUrl !== host.getLoadedUrl(),
      );

      if (soloUrlChanged) {
        loadedKeyRef.current = "";
      } else if (host && preview.slug === focusedSlug && !useSplit && !useSharedRoom) {
        setPointerLook(preview.pointerLook);
        host.setPointerLookEnabled(preview.pointerLook);
        host.getPresence().setMood(preview.mood);
        setMood(preview.mood);
        void host.setClothes(clothesInput(preview.clothes));
        if (preview.settings) {
          applyCompanionHostSettings(host, preview.settings);
        }
      }

      if (typeof preview.motionDebug === "boolean" && preview.motionDebug) {
        // Browser localStorage is SoT for the debug feed; live preview may only turn it ON.
        setMotionDebugEnabled(true);
      }

      setAvatars((rows) =>
        rows.map((a) => (a.slug === preview.slug ? mergeAvatarLivePreview(a, preview) : a)),
      );
    },
    [focusedSlug, useSplit, useSharedRoom],
  );

  useEffect(() => {
    if (!unpinned) return;
    function onMove(e: PointerEvent) {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.ox;
      const dy = e.clientY - dragRef.current.oy;
      setFloatPos({
        ...dragRef.current.start,
        x: Math.max(8, dragRef.current.start.x + dx),
        y: Math.max(8, dragRef.current.start.y + dy),
      });
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [unpinned]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (configDragRef.current) {
        setConfigPos({
          x: Math.max(8, configDragRef.current.startX + (e.clientX - configDragRef.current.ox)),
          y: Math.max(8, configDragRef.current.startY + (e.clientY - configDragRef.current.oy)),
        });
      }
      if (motionDragRef.current) {
        setMotionDebugPos({
          x: Math.max(8, motionDragRef.current.startX + (e.clientX - motionDragRef.current.ox)),
          y: Math.max(8, motionDragRef.current.startY + (e.clientY - motionDragRef.current.oy)),
        });
      }
      if (gestureTestDragRef.current) {
        setGestureTestPos({
          x: Math.max(8, gestureTestDragRef.current.startX + (e.clientX - gestureTestDragRef.current.ox)),
          y: Math.max(8, gestureTestDragRef.current.startY + (e.clientY - gestureTestDragRef.current.oy)),
        });
      }
      if (sceneDebugDragRef.current) {
        setSceneDebugPos({
          x: Math.max(8, sceneDebugDragRef.current.startX + (e.clientX - sceneDebugDragRef.current.ox)),
          y: Math.max(8, sceneDebugDragRef.current.startY + (e.clientY - sceneDebugDragRef.current.oy)),
        });
      }
    }
    function onUp() {
      configDragRef.current = null;
      motionDragRef.current = null;
      gestureTestDragRef.current = null;
      sceneDebugDragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const statusChip = agentStatus ? formatStatusChip(agentStatus) : null;
  const showLoading = companionLoading || (presenceLoading && !avatars.length);
  const configAvatar = avatars.find((a) => a.slug === configSlug) || focusedAvatar;

  const toolbar = (
    <div
      className="chat-avatar-hud slim has-voice"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (!unpinned || fullscreen) return;
        dragRef.current = { ox: e.clientX, oy: e.clientY, start: { ...floatPos } };
      }}
    >
      <SceneVoiceDock
        ttsText={ttsText}
        ttsMessageId={ttsMessageId}
        ttsStreaming={ttsStreaming}
        performanceText={performanceText || undefined}
        sessionId={sessionId}
        voiceId={voiceId || focusedAvatar?.fishVoiceId || null}
        onTranscript={onTranscript || (() => undefined)}
        onPlayTimedSteps={playTimedSteps}
        onTtsEnabledChange={setTtsEnabled}
        expressionNames={expressionNames}
        onPlaybackStream={applyPlaybackStream}
        onTtsPrepare={prepareLipSync}
        sources={ttsSources}
        onQueueState={(state) => {
          if (state.speakingSlug) ttsAuthorSlugRef.current = state.speakingSlug;
          setTtsPlayingSlug(state.speaking ? state.speakingSlug : null);
          onTtsQueueState?.(state);
        }}
        onTtsControls={onTtsControls}
        workspaceSpeakMode={workspaceSpeakMode}
        onWorkspaceSpeakModeChange={onWorkspaceSpeakModeChange}
      />
      <div className="chat-avatar-hud-end">
        <div className="chat-avatar-toolbar">
          {isGroup ? (
            <div className="chat-avatar-layout-toggle" title="Group scene layout">
              <IconBtn title="All agents in one scene" active={!useSplit} onClick={() => setLayout("shared")}>
                <SvgIcon d={ICONS.shared} />
              </IconBtn>
              <IconBtn title="Separate 3D view per agent" active={useSplit} onClick={() => setLayout("split")}>
                <SvgIcon d={ICONS.split} />
              </IconBtn>
            </div>
          ) : null}
          {focusedSlug ? (
            <IconBtn title={`Config @${focusedSlug}`} onClick={() => setConfigSlug(focusedSlug)}>
              <SvgIcon d={ICONS.gear} />
            </IconBtn>
          ) : null}
          {popoutMode ? (
            <IconBtn title="Return 3D to chat window" onClick={() => onReturnToChat?.()}>
              <SvgIcon d={ICONS.returnToChat} />
            </IconBtn>
          ) : (
            <IconBtn
              title={unpinned ? "Pin back" : "Unpin / drag"}
              active={unpinned}
              onClick={() => setUnpinned((v) => !v)}
            >
              <SvgIcon d={unpinned ? ICONS.pin : ICONS.unpin} />
            </IconBtn>
          )}
          <IconBtn
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            active={fullscreen}
            onClick={() => setFullscreen((v) => !v)}
          >
            <SvgIcon d={fullscreen ? ICONS.exitFullscreen : ICONS.fullscreen} />
          </IconBtn>
          {popoutMode || !onPopOut ? null : (
            <IconBtn title="Open 3D in a new window" onClick={() => onPopOut()}>
              <SvgIcon d={ICONS.popOut} />
            </IconBtn>
          )}
          <IconBtn
            title={
              motionDebugOn
                ? motionDebugOpen
                  ? "Hide motion debug (shift-click to disable)"
                  : "Show motion debug (shift-click to disable)"
                : "Enable motion debug feed"
            }
            active={motionDebugOn && motionDebugOpen}
            onClick={(e) => {
              if (e.shiftKey) {
                setMotionDebugEnabled(false);
                setMotionDebugOpen(false);
                return;
              }
              if (!motionDebugEnabled) {
                setMotionDebugEnabled(true);
                setMotionDebugOpen(true);
                return;
              }
              setMotionDebugOpen((v) => !v);
            }}
          >
            <SvgIcon d={ICONS.debug} />
          </IconBtn>
          {useSharedRoom || (!useSplit && !isGroup) ? (
            <IconBtn
              title={sceneDebugOpen ? "Hide scene objects debug" : "Show scene objects debug"}
              active={sceneDebugOpen}
              onClick={() => setSceneDebugOpen((v) => !v)}
            >
              <SvgIcon d={ICONS.scene} />
            </IconBtn>
          ) : null}
        </div>
        {statusChip ? (
          <span className="badge warn chat-agent-status-chip">
            <ExpandableLabel text={statusChip} max={28} />
          </span>
        ) : null}
      </div>
    </div>
  );

  const body = (
    <section
      className={`chat-avatar-viewport card ${fullscreen ? "fullscreen" : ""} ${unpinned && !fullscreen ? "floating" : ""}`}
      style={
        unpinned && !fullscreen
          ? {
              position: "fixed",
              left: floatPos.x,
              top: floatPos.y,
              width: floatPos.w,
              height: floatPos.h,
              zIndex: 80,
            }
          : undefined
      }
    >
      {useSplit ? (
        <div className={`chat-avatar-split n-${Math.min(avatars.length, 4)}`}>
          {avatars.map((avatar) => (
            <CompanionViewportCell
              key={avatar.slug}
              avatar={avatar}
              active={avatar.slug === focusedSlug}
              selected={avatar.slug === walkSlug}
              presence={presenceBySlug[avatar.slug]}
              agentStatus={agentStatus}
              toolEvents={toolEvents}
              sessionId={sessionId}
              performanceKey={performanceKey}
              performanceText={performanceText}
              ttsEnabled={ttsEnabled}
              speaking={ttsPlayingSlug === avatar.slug}
              onFocus={() => selectWalkSlug(avatar.slug)}
              onOpenConfig={() => {
                selectWalkSlug(avatar.slug);
                setConfigSlug(avatar.slug);
              }}
              onHostChange={(slug, host) => {
                if (host) splitHostsRef.current.set(slug, host);
                else splitHostsRef.current.delete(slug);
                setSplitHostGen((v) => v + 1);
              }}
            />
          ))}
        </div>
      ) : useSharedRoom ? (
        <SharedGroupScene
          slugs={normalizedSlugs}
          avatars={avatars.map((a) => ({ ...a, vrmUrl: resolveAvatarVrm(a.vrmUrl) }))}
          presenceBySlug={presenceBySlug}
          agentStatus={agentStatus}
          selectedSlug={walkSlug}
          lookAtRequest={lookAtRequest}
          ttsAuthorSlug={ttsAuthorSlug}
          speakingSlug={ttsPlayingSlug}
          performanceKey={performanceKey}
          performanceText={performanceText}
          ttsEnabled={ttsEnabled}
          savedPoses={savedPoses}
          posesReady={posesReady}
          sessionId={sessionId}
          onSelectSlug={selectWalkSlug}
          onOccupantsChange={postOccupants}
          onRoomChange={(room) => {
            sharedRoomRef.current = room;
            setSharedRoomGen((v) => v + 1);
          }}
          onSceneHostChange={(host) => {
            sceneHostRef.current = host;
            setSceneHost(host);
            setSharedRoomGen((v) => v + 1);
          }}
        />
      ) : (
        <div className="chat-avatar-scene-wrap">
          <canvas ref={canvasRef} className="chat-avatar-canvas" />
          {ttsPlayingSlug ? (
            <span className="chat-avatar-speak-badge" title={`@${ttsPlayingSlug} is speaking`} aria-label={`@${ttsPlayingSlug} is speaking`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M5 9v6h4l5 5V4L9 9H5Zm12.5 3A4.5 4.5 0 0 0 14 8.65v6.7A4.5 4.5 0 0 0 17.5 12Z"
                />
              </svg>
            </span>
          ) : null}
        </div>
      )}

      {toolbar}

      {motionDebugOn
        ? createPortal(
            <MotionDebugPopup
              open={motionDebugOpen}
              events={motionEvents}
              pos={motionDebugPos}
              onClose={() => setMotionDebugOpen(false)}
              onClear={() => setMotionEvents([])}
              onOpenGestureTest={openGestureTester}
              onDragHandlePointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                e.preventDefault();
                motionDragRef.current = {
                  ox: e.clientX,
                  oy: e.clientY,
                  startX: motionDebugPos.x,
                  startY: motionDebugPos.y,
                };
              }}
            />,
            document.body,
          )
        : null}

      {motionDebugOn
        ? createPortal(
            <GestureTestPopup
              open={gestureTestOpen}
              pos={gestureTestPos}
              getCatalog={listTestGestures}
              playingId={playingTestId}
              onPlay={playTestGesture}
              onClose={() => setGestureTestOpen(false)}
              onDragHandlePointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button, input")) return;
                e.preventDefault();
                gestureTestDragRef.current = {
                  ox: e.clientX,
                  oy: e.clientY,
                  startX: gestureTestPos.x,
                  startY: gestureTestPos.y,
                };
              }}
            />,
            document.body,
          )
        : null}

      {useSharedRoom || (!useSplit && !isGroup)
        ? createPortal(
            <SceneDebugPopup
              open={sceneDebugOpen}
              host={sceneHost}
              selectedAgentSlug={walkSlug || focusedSlug}
              pos={sceneDebugPos}
              onClose={() => setSceneDebugOpen(false)}
              onDragHandlePointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button, input, select")) return;
                e.preventDefault();
                sceneDebugDragRef.current = {
                  ox: e.clientX,
                  oy: e.clientY,
                  startX: sceneDebugPos.x,
                  startY: sceneDebugPos.y,
                };
              }}
            />,
            document.body,
          )
        : null}

      {configSlug && configAvatar
        ? createPortal(
            <div className="chat-avatar-config-overlay" role="dialog" aria-label={`Avatar config ${configSlug}`} data-ack-ignore="">
              <div
                className="chat-avatar-config-wrap"
                style={{
                  position: "fixed",
                  left: configPos.x,
                  top: configPos.y,
                  marginTop: 0,
                }}
              >
                <AvatarConfigPanel
                  open
                  slug={configSlug}
                  initialVrmUrl={
                    (configAvatar.vrmUrl || "").startsWith("blob:") ? "" : configAvatar.vrmUrl || ""
                  }
                  initialMood={configAvatar.mood || "neutral"}
                  initialPointerLook={configAvatar.pointerLook}
                  initialFishVoiceId={configAvatar.fishVoiceId || ""}
                  initialClothes={configAvatar.clothes}
                  initialSettings={{
                    ...configAvatar.settings,
                    motion_debug: motionDebugEnabled,
                  }}
                  companionHost={useSharedRoom ? null : hostRef.current}
                  sceneControls={useSplit || useSharedRoom ? null : sceneControls}
                  sceneMood={mood}
                  onSceneMoodChange={setMood}
                  onLiveChange={applyLivePreview}
                  onDragHandlePointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    e.preventDefault();
                    configDragRef.current = {
                      ox: e.clientX,
                      oy: e.clientY,
                      startX: configPos.x,
                      startY: configPos.y,
                    };
                  }}
                  onClose={() => setConfigSlug(null)}
                  onApplied={(patch) => {
                    const slug = configSlug;
                    if (slug) {
                      const existing = readAgentAvatar(slug);
                      writeAgentAvatar(slug, {
                        vrm_url: persistableVrmUrl(patch.vrm_url) || existing?.vrm_url || "",
                        default_mood: patch.default_mood || "neutral",
                        pointer_look: patch.pointer_look !== false,
                        fish_voice_id: patch.fish_voice_id || "",
                        clothes: (patch.clothes || {}) as Record<string, unknown>,
                        settings: patch.settings || {},
                      });
                    }
                    setAvatars((current) =>
                      current.map((a) =>
                        a.slug === slug
                          ? {
                              ...a,
                              vrmUrl: patch.objectUrl || persistableVrmUrl(patch.vrm_url) || a.vrmUrl,
                              mood: patch.default_mood || a.mood,
                              pointerLook: patch.pointer_look ?? a.pointerLook,
                              fishVoiceId:
                                patch.fish_voice_id === undefined
                                  ? a.fishVoiceId
                                  : patch.fish_voice_id || "",
                              clothes: patch.clothes || a.clothes,
                              settings: patch.settings || a.settings,
                            }
                          : a,
                      ),
                    );
                    if (slug) onPresenceApplied?.(slug, patch);
                    if (patch.settings && "motion_debug" in patch.settings) {
                      setMotionDebugEnabled(Boolean(patch.settings.motion_debug));
                    }
                    const nextUrl = patch.objectUrl || patch.vrm_url;
                    if (!useSharedRoom && nextUrl && nextUrl !== hostRef.current?.getLoadedUrl()) {
                      loadedKeyRef.current = "";
                    }
                  }}
                />
              </div>
            </div>,
            document.body,
          )
        : null}

      {fullscreen && !popoutMode && (
        <div className="chat-avatar-fs-overlays">
          <div className="chat-avatar-fs-chat">
            <button type="button" className="secondary" onClick={() => setChatCollapsed((v) => !v)}>
              {chatCollapsed ? "Show chat" : "Hide chat"}
            </button>
            {!chatCollapsed && collapsedChat}
          </div>
        </div>
      )}

      <div className="chat-avatar-footer">
        {showLoading && !useSplit && !useSharedRoom ? <span className="badge warn">…</span> : null}
        {error && !useSplit && !useSharedRoom ? <span className="badge bad">{error}</span> : null}
      </div>
      {!useSplit ? (
        <ViewportActionStack events={toolEvents} sessionId={sessionId} />
      ) : null}
    </section>
  );

  if (fullscreen || unpinned) {
    return createPortal(body, document.body);
  }
  return body;
}
