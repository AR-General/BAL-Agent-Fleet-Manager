import type { MouseEvent } from "react";
import { ExpandableLabel } from "../common/ExpandableLabel";
import {
  formatStatusChip,
  isLiveAgentState,
  type AgentLiveStatus,
} from "../../lib/agentStatusGestures";
import {
  formatLatencyMs,
  presenceLabel,
  presenceTone,
  type AgentPresence,
} from "../../lib/participantPresence";

type Props = {
  slug: string;
  presence?: AgentPresence | null;
  liveStatus?: AgentLiveStatus | null;
  as?: "span" | "button";
  active?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  onCancel?: () => void;
  cancelling?: boolean;
  paused?: boolean;
};

export function ParticipantPresenceChip({
  slug,
  presence,
  liveStatus,
  as = "span",
  active,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onCancel,
  cancelling,
  paused,
}: Props) {
  const tone = presenceTone(presence?.status, presence?.online);
  const label = presenceLabel(presence);
  const rtt = formatLatencyMs(presence?.online ? presence.latency_ms : null);
  const live = isLiveAgentState(liveStatus?.state);
  const title = [
    `@${slug}`,
    active ? "primary responder" : null,
    live && liveStatus ? formatStatusChip(liveStatus) : null,
    paused ? "paused (ignoring)" : label,
    presence?.online ? rtt : presence?.error || "unreachable",
    presence?.last_seen ? `last ${new Date(presence.last_seen).toLocaleTimeString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const className = [
    "chat-participant-chip",
    tone,
    active ? "active" : "",
    selected ? "selected" : "",
    live ? "live" : "",
    paused ? "paused" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const main = (
    <>
      <span className={`dot ${tone}${live ? " live" : ""}`} />
      <span className="chat-participant-slug">@{slug}</span>
      {live && liveStatus ? (
        <span className="chat-participant-think" title={formatStatusChip(liveStatus)}>
          <span className="chat-participant-think-emoji" aria-hidden="true">
            {liveStatus.emoji || "💭"}
          </span>
          <ExpandableLabel
            className="chat-participant-think-label"
            text={liveStatus.label || liveStatus.state}
            max={24}
          />
        </span>
      ) : paused ? (
        <span className="chat-participant-state">paused</span>
      ) : (
        <>
          <span className="chat-participant-state">{label}</span>
          <span className="chat-participant-rtt">{rtt}</span>
        </>
      )}
    </>
  );

  const cancelBtn =
    live && onCancel ? (
      <button
        type="button"
        className="chat-participant-cancel"
        title={`Cancel @${slug}`}
        aria-label={`Cancel @${slug}`}
        disabled={cancelling}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      >
        {cancelling ? "…" : "✕"}
      </button>
    ) : null;

  // Never nest buttons: when cancel is present, use a wrapper with a separate primary control.
  if (as === "button" && cancelBtn) {
    return (
      <span className={`${className} with-cancel`} title={title} onContextMenu={onContextMenu}>
        <button
          type="button"
          className="chat-participant-chip-main"
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        >
          {main}
        </button>
        {cancelBtn}
      </span>
    );
  }

  if (as === "button") {
    return (
      <button
        type="button"
        className={className}
        title={title}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        {main}
      </button>
    );
  }

  return (
    <span className={className} title={title} onContextMenu={onContextMenu}>
      {main}
      {cancelBtn}
    </span>
  );
}
