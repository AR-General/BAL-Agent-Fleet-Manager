import type { HermesMessage } from "./hermesClient.js";

export type HistoryTurn = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  authorSlug?: string | null;
};

export const BROADCAST_ALIASES = new Set(["all", "room", "everyone"]);

export const MAX_AGENT_AUTO_TURNS_MIN = 1;
export const MAX_AGENT_AUTO_TURNS_MAX = 20;
export const MAX_AGENT_AUTO_TURNS_DEFAULT = 5;

export function clampMaxAgentAutoTurns(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MAX_AGENT_AUTO_TURNS_DEFAULT;
  return Math.min(MAX_AGENT_AUTO_TURNS_MAX, Math.max(MAX_AGENT_AUTO_TURNS_MIN, Math.floor(n)));
}

/**
 * Parse @mentions from message text. Skips email-like tokens (`user@host`)
 * and treats all/room/everyone as broadcast aliases.
 */
export function parseMentionTokens(message: string): {
  broadcast: boolean;
  slugs: string[];
} {
  const re = /(^|[\s([{<"'])@([a-zA-Z0-9][a-zA-Z0-9_-]*)/g;
  const slugs: string[] = [];
  let broadcast = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    const token = m[2]!.toLowerCase();
    if (BROADCAST_ALIASES.has(token)) {
      broadcast = true;
      continue;
    }
    slugs.push(token);
  }
  return { broadcast, slugs: [...new Set(slugs)] };
}

/**
 * Resolve which instance participants should generate a reply.
 * human_only + no mention → primary only.
 * mentioned_only + no mention → nobody.
 * @all/@room → everyone (caller applies budget).
 * explicit @slug → those room members.
 */
export function selectReplyTargetIds(opts: {
  replyPolicy: string;
  participantInstanceIds: string[];
  mentionSlugs: string[];
  broadcast?: boolean;
  slugByInstanceId: Map<string, string>;
  primaryInstanceId?: string | null;
  pausedInstanceIds?: string[];
}): string[] {
  if (opts.replyPolicy === "off") return [];
  const paused = new Set((opts.pausedInstanceIds || []).filter(Boolean));
  const participants = [...new Set(opts.participantInstanceIds.filter((id) => id && !paused.has(id)))];
  if (!participants.length) return [];

  if (opts.broadcast) {
    return participants;
  }

  const mentions = opts.mentionSlugs.map((s) => s.toLowerCase()).filter(Boolean);
  if (mentions.length) {
    const mentionSet = new Set(mentions);
    return participants.filter((id) => {
      const slug = opts.slugByInstanceId.get(id)?.toLowerCase();
      return Boolean(slug && mentionSet.has(slug));
    });
  }

  if (opts.replyPolicy === "mentioned_only") return [];

  // human_only: primary only (default = first participant by join order).
  const primary =
    opts.primaryInstanceId && participants.includes(opts.primaryInstanceId)
      ? opts.primaryInstanceId
      : participants[0]!;
  return [primary];
}

/**
 * Cap targets by remaining auto-turn budget. Prefer online agents when truncating.
 */
export function applyAutoTurnBudget(opts: {
  targetIds: string[];
  remainingTurns: number;
  onlineByInstanceId?: Map<string, boolean>;
  /** Human @all/@room (and explicit @everyone): do not drop members on the first hop. */
  skipBudget?: boolean;
}): { generate: string[]; ignore: string[] } {
  if (opts.skipBudget) {
    return { generate: [...opts.targetIds], ignore: [] };
  }
  const remaining = Math.max(0, Math.floor(opts.remainingTurns));
  if (remaining <= 0) {
    return { generate: [], ignore: [...opts.targetIds] };
  }
  if (opts.targetIds.length <= remaining) {
    return { generate: [...opts.targetIds], ignore: [] };
  }

  const online = opts.onlineByInstanceId;
  const ranked = [...opts.targetIds].sort((a, b) => {
    const ao = online?.get(a) === false ? 1 : 0;
    const bo = online?.get(b) === false ? 1 : 0;
    return ao - bo;
  });
  return {
    generate: ranked.slice(0, remaining),
    ignore: ranked.slice(remaining),
  };
}

/** Map stored turns into Hermes messages from one agent's point of view. */
export function toHermesHistoryForAgent(turns: HistoryTurn[], selfSlug: string): HermesMessage[] {
  const out: HermesMessage[] = [];
  for (const turn of turns) {
    if (!turn.content) continue;
    if (turn.role === "assistant" && turn.authorSlug && turn.authorSlug !== selfSlug) {
      out.push({
        role: "user",
        content: `@${turn.authorSlug}: ${turn.content}`,
      });
      continue;
    }
    if (turn.role === "system" || turn.role === "tool") {
      out.push({ role: turn.role, content: turn.content });
      continue;
    }
    out.push({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content,
    });
  }
  return out;
}
