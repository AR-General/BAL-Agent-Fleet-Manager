/**
 * Single-participant CompanionHost cell for split (per-avatar) scene layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompanionHost, type ClothesOverlayPiece } from "@openclaw/character-kit";
import { useAgentStatusMotions } from "../../hooks/useAgentStatusMotions";
import { useInlineTagPerformance } from "../../hooks/useInlineTagPerformance";
import { parseStatusMotions, type AgentLiveStatus } from "../../lib/agentStatusGestures";
import type { ViewportToolEvent } from "../../lib/toolActionToasts";
import { applyCompanionHostSettings } from "../../lib/companionHostSettings";
import { CLOTHES_OVERLAY_CATALOG, VRM_CATALOG } from "../../lib/vrmCatalog";
import { useResolvedVrmUrl } from "../../hooks/useResolvedVrmUrl";
import type { AvatarClothesState } from "../avatar/AvatarConfigPanel";
import { ViewportActionStack } from "./ViewportActionStack";
import { ParticipantPresenceChip } from "./ParticipantPresenceChip";
import type { AgentPresence } from "../../lib/participantPresence";

export type CellAvatar = {
  slug: string;
  vrmUrl: string;
  mood: string;
  pointerLook: boolean;
  clothes: AvatarClothesState;
  settings?: Record<string, unknown>;
};

type Props = {
  avatar: CellAvatar;
  active: boolean;
  selected?: boolean;
  agentStatus?: AgentLiveStatus | null;
  toolEvents?: ViewportToolEvent[];
  sessionId?: string;
  performanceKey?: string | null;
  performanceText?: string | null;
  ttsEnabled?: boolean;
  speaking?: boolean;
  onFocus: () => void;
  onOpenConfig: () => void;
  presence?: AgentPresence | null;
  onHostChange?: (slug: string, host: CompanionHost | null) => void;
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

function isDisposedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /disposed/i.test(msg);
}

export function CompanionViewportCell({
  avatar,
  active,
  selected = false,
  agentStatus,
  toolEvents = [],
  sessionId,
  performanceKey,
  performanceText,
  ttsEnabled = false,
  speaking = false,
  onFocus,
  onOpenConfig,
  presence,
  onHostChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<CompanionHost | null>(null);
  const loadedUrlRef = useRef("");
  const loadTokenRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hostReady, setHostReady] = useState(0);
  const motions = useMemo(() => parseStatusMotions(avatar.settings), [avatar.settings]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const host = new CompanionHost(canvasRef.current, {
      background: 0x12171c,
      orbitControls: true,
      pointerLook: avatar.pointerLook,
    });
    hostRef.current = host;
    onHostChange?.(avatar.slug, host);
    setHostReady((v) => v + 1);
    const ro = new ResizeObserver(() => host.resize());
    if (canvasRef.current.parentElement) ro.observe(canvasRef.current.parentElement);
    return () => {
      loadTokenRef.current += 1;
      ro.disconnect();
      onHostChange?.(avatar.slug, null);
      host.dispose();
      hostRef.current = null;
      loadedUrlRef.current = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolvedVrm = useResolvedVrmUrl(avatar.vrmUrl);

  const load = useCallback(async (token: number) => {
    const host = hostRef.current;
    if (!host || !resolvedVrm) return;
    if (loadedUrlRef.current === resolvedVrm) {
      host.setMood(avatar.mood);
      host.setPointerLookEnabled(avatar.pointerLook);
      applyCompanionHostSettings(host, avatar.settings);
      void host.setClothes({
        id: avatar.clothes?.clothesId || "default",
        ids: avatar.clothes?.clothesIds,
        overlayPieces: overlayPiecesFromClothes(avatar.clothes),
      });
      return;
    }
    setLoading(true);
    setError("");
    try {
      await host.load({
        vrmUrl: resolvedVrm,
        gestureManifestUrl: GESTURE_MANIFEST_URL,
        mood: avatar.mood,
        clothes: {
          id: avatar.clothes?.clothesId || "default",
          ids: avatar.clothes?.clothesIds,
          overlayPieces: overlayPiecesFromClothes(avatar.clothes),
        },
        pointerLook: avatar.pointerLook,
      });
      if (token !== loadTokenRef.current || hostRef.current !== host) return;
      loadedUrlRef.current = resolvedVrm;
      applyCompanionHostSettings(host, avatar.settings);
      host.setInteractionAckActive(active);
    } catch (e) {
      if (token !== loadTokenRef.current || hostRef.current !== host) return;
      if (isDisposedError(e)) {
        console.warn("CompanionViewportCell load aborted after dispose", avatar.slug);
        return;
      }
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, [avatar, active, resolvedVrm]);

  useEffect(() => {
    if (hostReady < 1) return;
    const token = ++loadTokenRef.current;
    void load(token);
    return () => {
      loadTokenRef.current += 1;
    };
  }, [load, hostReady]);

  useEffect(() => {
    hostRef.current?.setInteractionAckActive(active);
  }, [active, hostReady]);

  const tagPerforming = useInlineTagPerformance({
    host: hostReady > 0 ? hostRef.current : null,
    performanceKey,
    performanceText,
    ttsEnabled,
    enabled:
      active &&
      !loading &&
      hostReady > 0 &&
      Boolean(hostRef.current?.getLoadedUrl()),
  });

  useAgentStatusMotions({
    host: hostReady > 0 ? hostRef.current : null,
    agentStatus,
    motions,
    enabled:
      !tagPerforming &&
      Boolean(agentStatus?.authorSlug ? agentStatus.authorSlug === avatar.slug : active),
    focusedSlug: avatar.slug,
  });

  return (
    <div
      className="chat-avatar-cell"
      onClick={onFocus}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onFocus();
      }}
    >
      <canvas ref={canvasRef} className="chat-avatar-canvas" />
      {speaking ? (
        <span className="chat-avatar-speak-badge" title={`@${avatar.slug} is speaking`} aria-label={`@${avatar.slug} is speaking`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M5 9v6h4l5 5V4L9 9H5Zm12.5 3A4.5 4.5 0 0 0 14 8.65v6.7A4.5 4.5 0 0 0 17.5 12Z"
            />
          </svg>
        </span>
      ) : null}
      <div className="chat-avatar-cell-hud">
        <ParticipantPresenceChip
          slug={avatar.slug}
          presence={presence}
          selected={selected}
          liveStatus={
            agentStatus &&
            (agentStatus.authorSlug ? agentStatus.authorSlug === avatar.slug : active)
              ? agentStatus
              : null
          }
        />
        <button
          type="button"
          className="kb-icon"
          title={`Config @${avatar.slug}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenConfig();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.77 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.13.22.39.3.59.22l2.39-.96c.5.39 1.04.71 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.55 1.62-.94l2.39.96c.22.08.46 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
            />
          </svg>
        </button>
      </div>
      {loading ? <span className="badge warn chat-avatar-cell-badge">…</span> : null}
      {error ? <span className="badge bad chat-avatar-cell-badge">{error}</span> : null}
      <ViewportActionStack events={toolEvents} sessionId={sessionId} filterSlug={avatar.slug} />
    </div>
  );
}
