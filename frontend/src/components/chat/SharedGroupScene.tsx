/**
 * One shared SceneRoom: every group participant occupies a reserved spawn slot.
 * Offline / failed loads keep an empty status-colored circle; names follow heads
 * and sit above the mesh AABB so hair/ears stay clear.
 *
 * Each occupant boots like a DM CompanionHost: VRMA idle pack, that agent's mood,
 * and ambient presence. Without the gesture pack they freeze in T-pose (hands up).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SceneRoom,
  occupantRosterKey,
  type ClothesOverlayPiece,
  type SceneOccupantPose,
  type SceneRoomOccupant,
} from "@nexus/character-kit";
import { useAgentStatusMotions } from "../../hooks/useAgentStatusMotions";
import { useInlineTagPerformance } from "../../hooks/useInlineTagPerformance";
import { parseStatusMotions, type AgentLiveStatus } from "../../lib/agentStatusGestures";
import { applyLocoSettings } from "../../lib/companionHostSettings";
import { buildGroupOccupants, mergeOccupantPoses, resolveGroupSpeakerSlug } from "../../lib/groupSceneOccupants";
import type { AgentPresence } from "../../lib/participantPresence";
import { createSceneGraphHost, bridgeFromSceneRoom, type SceneGraphHost } from "../../lib/sceneGraphHost";
import { sceneRoomMotionHost } from "../../lib/sceneRoomMotionHost";
import { CLOTHES_OVERLAY_CATALOG, VRM_CATALOG } from "../../lib/vrmCatalog";
import type { AvatarClothesState } from "../avatar/AvatarConfigPanel";

export type GroupSceneAvatar = {
  slug: string;
  vrmUrl: string;
  mood: string;
  clothes?: AvatarClothesState;
  settings?: Record<string, unknown>;
};

type Props = {
  slugs: string[];
  avatars: GroupSceneAvatar[];
  presenceBySlug: Record<string, AgentPresence>;
  agentStatus?: AgentLiveStatus | null;
  selectedSlug?: string | null;
  lookAtRequest?: { slug: string; token: number } | null;
  onSelectSlug: (slug: string) => void;
  onRoomChange?: (room: SceneRoom | null) => void;
  onOccupantsChange?: (poses: SceneOccupantPose[]) => void;
  onSceneHostChange?: (host: SceneGraphHost | null) => void;
  ttsAuthorSlug?: string;
  speakingSlug?: string | null;
  performanceKey?: string | null;
  performanceText?: string | null;
  ttsEnabled?: boolean;
  savedPoses?: SceneOccupantPose[];
  posesReady?: boolean;
  sessionId?: string;
};

const GESTURE_MANIFEST_URL = "/dev-vrm-assets/vrma/manifest.json";

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

function applyOccupantPresentation(
  room: SceneRoom,
  avatars: GroupSceneAvatar[],
): void {
  for (const avatar of avatars) {
    const handle = room.getAvatar(avatar.slug);
    if (!handle) continue;
    applyLocoSettings(handle.controller, avatar.settings);
    void handle.controller.setClothes({
      id: avatar.clothes?.clothesId || "default",
      ids: avatar.clothes?.clothesIds,
      overlayPieces: overlayPiecesFromClothes(avatar.clothes),
    });
  }
}

function SharedGroupSpeakerRuntime({
  room,
  occupantsReady,
  slug,
  avatar,
  agentStatus,
  performanceKey,
  performanceText,
  ttsEnabled,
}: {
  room: SceneRoom;
  occupantsReady: number;
  slug: string;
  avatar?: GroupSceneAvatar;
  agentStatus?: AgentLiveStatus | null;
  performanceKey?: string | null;
  performanceText?: string | null;
  ttsEnabled: boolean;
}) {
  const host = useMemo(() => {
    if (occupantsReady < 1) return null;
    const next = room.getAvatar(slug);
    return next ? sceneRoomMotionHost(next) : null;
  }, [occupantsReady, room, slug]);
  const tagHost = useMemo(
    () =>
      host
        ? {
            playInlineTags: (text: string, opts?: { locomotionOnly?: boolean }) =>
              room.playInlineTags(slug, text, opts),
          }
        : null,
    [host, room, slug],
  );
  const motions = useMemo(() => parseStatusMotions(avatar?.settings), [avatar?.settings]);
  const tagPerforming = useInlineTagPerformance({
    host: tagHost,
    performanceKey,
    performanceText,
    ttsEnabled,
    enabled: Boolean(tagHost),
  });
  useAgentStatusMotions({
    host,
    agentStatus,
    motions,
    enabled: !tagPerforming && Boolean(host),
    focusedSlug: slug,
  });
  return null;
}

export function SharedGroupScene({
  slugs,
  avatars,
  presenceBySlug,
  agentStatus,
  selectedSlug = null,
  lookAtRequest = null,
  onSelectSlug,
  onRoomChange,
  onOccupantsChange,
  onSceneHostChange,
  ttsAuthorSlug,
  speakingSlug = null,
  performanceKey,
  performanceText,
  ttsEnabled = false,
  savedPoses = [],
  posesReady = true,
  sessionId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const roomRef = useRef<SceneRoom | null>(null);
  const sceneHostRef = useRef<SceneGraphHost | null>(null);
  const selectRef = useRef(onSelectSlug);
  const roomChangeRef = useRef(onRoomChange);
  const sceneHostChangeRef = useRef(onSceneHostChange);
  const loadGenRef = useRef(0);
  const avatarsRef = useRef(avatars);
  const livePosesRef = useRef<SceneOccupantPose[]>([]);
  const [ready, setReady] = useState(0);
  const [occupantsReady, setOccupantsReady] = useState(0);
  const [error, setError] = useState("");
  selectRef.current = onSelectSlug;
  roomChangeRef.current = onRoomChange;
  sceneHostChangeRef.current = onSceneHostChange;
  avatarsRef.current = avatars;

  useEffect(() => {
    livePosesRef.current = savedPoses;
  }, [sessionId, savedPoses]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const room = new SceneRoom(canvasRef.current, {
      background: 0x12171c,
      orbitControls: true,
      pointerLook: true,
      gestureManifestUrl: GESTURE_MANIFEST_URL,
      onLabelClick: (id) => selectRef.current(id),
      onLabelDblClick: (id) => selectRef.current(id),
    });
    roomRef.current = room;
    roomChangeRef.current?.(room);
    setReady((v) => v + 1);
    return () => {
      loadGenRef.current += 1;
      try {
        sceneHostRef.current?.dispose();
      } catch {
        /* ignore */
      }
      sceneHostRef.current = null;
      sceneHostChangeRef.current?.(null);
      roomChangeRef.current?.(null);
      room.dispose();
      roomRef.current = null;
    };
  }, []);

  /** Scene graph host: objects/robots; fail-soft so avatars still render. */
  useEffect(() => {
    const room = roomRef.current;
    if (!room || ready < 1 || !sessionId) {
      if (sceneHostRef.current) {
        try {
          sceneHostRef.current.dispose();
        } catch {
          /* ignore */
        }
        sceneHostRef.current = null;
        sceneHostChangeRef.current?.(null);
      }
      return;
    }
    let cancelled = false;
    let host: SceneGraphHost | null = null;
    try {
      host = createSceneGraphHost({ bridge: bridgeFromSceneRoom(room), sessionId });
    } catch (err) {
      console.warn("[scene-host] create failed; continuing with avatars only", err);
      host = null;
    }
    if (cancelled) {
      host?.dispose();
      return;
    }
    sceneHostRef.current = host;
    sceneHostChangeRef.current?.(host);

    let raf = 0;
    const loop = () => {
      try {
        sceneHostRef.current?.tick();
      } catch {
        /* ignore tick errors */
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
    const canvas = room.renderer.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      try {
        host?.dispose();
      } catch {
        /* ignore */
      }
      if (sceneHostRef.current === host) {
        sceneHostRef.current = null;
        sceneHostChangeRef.current?.(null);
      }
    };
  }, [ready, sessionId]);

  const occupants = useMemo(
    (): SceneRoomOccupant[] => buildGroupOccupants(slugs, avatars, presenceBySlug, savedPoses),
    [avatars, presenceBySlug, savedPoses, slugs],
  );
  const occupantsRef = useRef(occupants);
  occupantsRef.current = occupants;
  const lookAtRef = useRef(lookAtRequest);
  lookAtRef.current = lookAtRequest;
  const framedLookTokenRef = useRef<number | null>(null);
  const rosterKey = useMemo(() => occupantRosterKey(occupants), [occupants]);
  const clothesKey = avatars
    .map(
      (a) =>
        `${a.slug}:${a.clothes?.clothesId || ""}:${(a.clothes?.clothesIds || []).join(",")}:${a.clothes?.clothesOverlayItems?.length || 0}`,
    )
    .join("|");
  const speakerSlug = resolveGroupSpeakerSlug(
    ttsAuthorSlug,
    agentStatus?.authorSlug,
    selectedSlug,
    slugs,
  );
  const speakerAvatar = avatars.find((a) => a.slug === speakerSlug);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || ready < 1 || !posesReady) return;
    const gen = ++loadGenRef.current;
    setError("");
    void room
      .setOccupants(mergeOccupantPoses(occupantsRef.current, livePosesRef.current))
      .then(() => {
        if (gen !== loadGenRef.current) return;
        applyOccupantPresentation(room, avatarsRef.current);
        setOccupantsReady((v) => v + 1);
        const look = lookAtRef.current;
        if (!look?.slug || framedLookTokenRef.current === look.token) return;
        room.setSelected(look.slug);
        if (room.frameFacing(look.slug)) framedLookTokenRef.current = look.token;
      })
      .catch((err) => {
        if (gen !== loadGenRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (/disposed/i.test(msg)) return;
        console.error("SceneRoom setOccupants failed", err);
        setError(msg);
      });
  }, [rosterKey, ready, posesReady, sessionId]);

  const restoredForRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!posesReady || occupantsReady < 1) return;
    const token = sessionId || "";
    if (restoredForRef.current === token) return;
    const room = roomRef.current;
    const poses = livePosesRef.current.length ? livePosesRef.current : savedPoses;
    if (!room || !poses.length) return;
    const applied = room.applyOccupantPoses(poses);
    if (applied > 0) restoredForRef.current = token;
  }, [occupantsReady, posesReady, savedPoses, sessionId]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || occupantsReady < 1) return;
    applyOccupantPresentation(room, avatars);
  }, [avatars, clothesKey, occupantsReady]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || ready < 1) return;
    room.setSelected(selectedSlug);
  }, [selectedSlug, ready]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || ready < 1 || !lookAtRequest?.slug) return;
    const slug = lookAtRequest.slug;
    const token = lookAtRequest.token;
    room.setSelected(slug);
    if (room.frameFacing(slug)) {
      framedLookTokenRef.current = token;
      return;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (room.frameFacing(slug)) {
        framedLookTokenRef.current = token;
        window.clearInterval(timer);
        return;
      }
      if (attempts >= 24) window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
  }, [lookAtRequest?.slug, lookAtRequest?.token, ready]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || ready < 1) return;
    room.setSpeaking(speakingSlug && slugs.includes(speakingSlug) ? speakingSlug : null);
  }, [speakingSlug, ready, occupantsReady, slugs]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || occupantsReady < 1 || !onOccupantsChange) return;
    const tick = () => {
      const poses = room.snapshotOccupants();
      if (!poses.length) return;
      livePosesRef.current = poses;
      onOccupantsChange(poses);
    };
    tick();
    const timer = window.setInterval(tick, 1500);
    return () => window.clearInterval(timer);
  }, [occupantsReady, onOccupantsChange, rosterKey]);

  return (
    <div className="chat-avatar-scene-wrap">
      <canvas ref={canvasRef} className="chat-avatar-canvas" />
      {error ? <span className="badge bad chat-avatar-cell-badge">{error}</span> : null}
      {roomRef.current && speakerSlug ? (
        <SharedGroupSpeakerRuntime
          room={roomRef.current}
          occupantsReady={occupantsReady}
          slug={speakerSlug}
          avatar={speakerAvatar}
          agentStatus={agentStatus}
          performanceKey={performanceKey}
          performanceText={performanceText}
          ttsEnabled={ttsEnabled}
        />
      ) : null}
    </div>
  );
}
