import type { ToolCallVisual } from "../components/chat/types";
import { truncateDisplayText } from "./truncateDisplayText.ts";

export type ViewportToolEvent = ToolCallVisual & {
  authorSlug?: string;
};

export type ToolActionToast = {
  id: string;
  kind: string;
  emoji: string;
  label: string;
  fullLabel: string;
  status: string;
  count: number;
  authorSlug?: string;
  pulse: number;
  leaving: boolean;
  expiresAt: number;
};

export const TOOL_TOAST_TTL_MS = 3800;
export const TOOL_TOAST_DONE_TTL_MS = 2200;
export const TOOL_TOAST_MAX = 6;
export const TOOL_TOAST_EXIT_MS = 320;

const KIND_EMOJI: Record<string, string> = {
  gesture: "🎭",
  mood: "🙂",
  face: "😊",
  move: "🚶",
  clothes: "👕",
  search: "🔍",
  read: "📖",
  write: "✍️",
  shell: "⚙️",
  web: "🌐",
  tool: "🛠️",
};

const KIND_ALIASES: Record<string, string> = {
  character_play_gesture: "gesture",
  play_gesture: "gesture",
  character_run_sequence: "gesture",
  character_set_mood: "mood",
  set_mood: "mood",
  character_set_emotion: "face",
  character_set_expression: "face",
  set_emotion: "face",
  character_walk: "move",
  character_walk_to: "move",
  character_turn: "move",
  character_jump: "move",
  character_teleport: "move",
  character_stop: "move",
  character_set_clothes: "clothes",
  web_search: "search",
  search: "search",
  browse: "search",
  fetch: "search",
  read: "read",
  recall: "read",
  shell: "shell",
  exec: "shell",
  terminal: "shell",
  command: "shell",
  write: "write",
  edit: "write",
  patch: "write",
};

function lastSegment(name: string): string {
  const cleaned = name.replace(/^character[._]/, "").replace(/[._]/g, "_");
  const parts = cleaned.split("_").filter(Boolean);
  return parts[parts.length - 1] || cleaned || "tool";
}

/** Compact kind for stacking: gesture / search / shell / … */
export function toolActionKind(tool?: string, label?: string): string {
  const raw = `${tool || ""} ${label || ""}`.trim().toLowerCase();
  if (!raw) return "tool";
  const token = (tool || label || "tool").toLowerCase().replace(/[.\s]+/g, "_");
  if (KIND_ALIASES[token]) return KIND_ALIASES[token];
  for (const [from, kind] of Object.entries(KIND_ALIASES)) {
    if (raw.includes(from.replace(/_/g, " ")) || raw.includes(from)) return kind;
  }
  if (/\bsearch|browse|fetch|web\b/.test(raw)) return "search";
  if (/\bshell|exec|terminal|command\b/.test(raw)) return "shell";
  if (/\bwalk|turn|jump|teleport\b/.test(raw)) return "move";
  if (/\bgesture|wave|nod|think\b/.test(raw)) return "gesture";
  return lastSegment(token);
}

export function toolActionEmoji(kind: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback;
  return KIND_EMOJI[kind] || KIND_EMOJI.tool;
}

export const TOOL_LABEL_MAX = 22;

export function toolActionLabel(kind: string, label?: string, tool?: string): string {
  const raw = (label || "").trim();
  if (raw && raw.length <= TOOL_LABEL_MAX) return raw;
  if (KIND_ALIASES[(tool || "").toLowerCase()] || KIND_EMOJI[kind]) return kind;
  const fallback = lastSegment(tool || kind);
  return truncateDisplayText(fallback, TOOL_LABEL_MAX).preview;
}

function ttlForStatus(status?: string): number {
  return status === "done" || status === "ok" || status === "success"
    ? TOOL_TOAST_DONE_TTL_MS
    : TOOL_TOAST_TTL_MS;
}

export function upsertToolActionToast(
  stack: ToolActionToast[],
  event: ViewportToolEvent,
  now = Date.now(),
  opts: { bumpCount?: boolean } = {},
): ToolActionToast[] {
  const kind = toolActionKind(event.tool, event.label);
  const label = toolActionLabel(kind, event.label, event.tool);
  const fullLabel = (event.label || event.tool || label).trim() || label;
  const emoji = toolActionEmoji(kind, event.emoji);
  const status = event.status || "running";
  const expiresAt = now + ttlForStatus(status);
  const bumpCount = opts.bumpCount !== false;

  const live = stack.filter((row) => !row.leaving);
  const match = [...live].reverse().find((row) => row.kind === kind);

  if (match) {
    return stack.map((row) =>
      row.id === match.id
        ? {
            ...row,
            emoji,
            label,
            fullLabel,
            status,
            count: bumpCount ? row.count + 1 : row.count,
            pulse: bumpCount ? row.pulse + 1 : row.pulse,
            authorSlug: event.authorSlug ?? row.authorSlug,
            leaving: false,
            expiresAt,
          }
        : row,
    );
  }

  const next: ToolActionToast = {
    id: `toast-${kind}-${now}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    emoji,
    label,
    fullLabel,
    status,
    count: 1,
    authorSlug: event.authorSlug,
    pulse: 0,
    leaving: false,
    expiresAt,
  };
  return [...stack, next].slice(-TOOL_TOAST_MAX);
}

export function expireToolActionToasts(
  stack: ToolActionToast[],
  now = Date.now(),
): ToolActionToast[] {
  const next = stack
    .map((row) => {
      if (!row.leaving && row.expiresAt <= now) {
        return { ...row, leaving: true };
      }
      return row;
    })
    .filter((row) => !(row.leaving && now - row.expiresAt >= TOOL_TOAST_EXIT_MS));
  if (next.length === stack.length && next.every((row, i) => row === stack[i])) return stack;
  return next;
}

export function collectViewportToolEvents(
  messages: Array<{ authorSlug?: string; toolCalls?: ToolCallVisual[] }>,
): ViewportToolEvent[] {
  const out: ViewportToolEvent[] = [];
  for (const message of messages) {
    for (const call of message.toolCalls || []) {
      out.push({ ...call, authorSlug: message.authorSlug });
    }
  }
  return out;
}
