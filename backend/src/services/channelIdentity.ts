import { config } from "../config.js";
import type { AuthUser } from "../middleware/auth.js";
import { formatCharacterSpeakPrompt } from "./characterSpeakTool.js";
import {
  formatViewportMotionPrompt,
  type SceneOccupantPose,
} from "./sceneOccupancy.js";
import type { TtsSpeakMode } from "./ttsSpeakMode.js";

export type VerifiedChannelIdentity = {
  verified: true;
  email: string;
  displayName: string;
  userId: string;
};

export type PublicChannelIdentity = {
  verified: false;
  email?: string;
  displayName?: string;
  userId?: string;
};

export type ChannelIdentity = VerifiedChannelIdentity | PublicChannelIdentity;

/** Parse "email:Display Name,email2:Name2" or bare emails (display = local-part). */
function parseVerifiedMap(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = (process.env.OC_VERIFIED_CHANNEL_USERS || "").trim();
  if (raw) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const [email, ...nameParts] = trimmed.split(":");
      const key = email.trim().toLowerCase();
      if (!key) continue;
      const name = nameParts.join(":").trim() || key.split("@")[0] || key;
      map.set(key, name);
    }
  }
  // Admin portal account is always verified for this install (exactly that user).
  const admin = config.adminEmail.trim().toLowerCase();
  if (admin && !map.has(admin)) {
    map.set(admin, process.env.OC_VERIFIED_DISPLAY_NAME?.trim() || "Admin");
  }
  return map;
}

export function resolveChannelIdentity(user?: AuthUser | null): ChannelIdentity {
  if (!user?.email) {
    return { verified: false };
  }
  const verified = parseVerifiedMap();
  const email = user.email.trim().toLowerCase();
  const displayName = verified.get(email);
  if (!displayName) {
    return {
      verified: false,
      email: user.email,
      userId: user.id,
      displayName: user.email.split("@")[0],
    };
  }
  return {
    verified: true,
    email: user.email,
    displayName,
    userId: user.id,
  };
}

/**
 * Compact channel framing for the agent gateway.
 * Verified users get owner identity; everyone else gets strict public professional mode.
 */
export function buildChannelSystemPrompt(opts: {
  agentSlug: string;
  identity: ChannelIdentity;
  viewport3dActive?: boolean;
  sessionType?: string;
  participantSlugs?: string[];
  primarySlug?: string | null;
  replyPolicy?: string;
  sceneOccupants?: SceneOccupantPose[];
  /** When "tool", instruct the agent to use character_speak instead of auto-TTS. */
  ttsSpeakMode?: TtsSpeakMode;
}): string {
  const roster = [...new Set((opts.participantSlugs || []).map((s) => s.trim()).filter(Boolean))];
  const peers = roster.filter((s) => s.toLowerCase() !== opts.agentSlug.toLowerCase());
  const isGroup = opts.sessionType === "group" || peers.length > 0;
  const replyPolicy = opts.replyPolicy || "human_only";
  const primary =
    opts.primarySlug?.trim() ||
    (roster.length ? roster[0] : null);

  const lines: string[] = [
    `Channel: oc-controller portal (verified transport). Agent slug: @${opts.agentSlug}.`,
    "User-visible chat is the assistant message body. Do not dump chain-of-thought, internal scratchpads, or raw tool JSON in that body.",
    "Keep answers direct and professional unless the human clearly switches to social/roleplay.",
  ];
  if (opts.ttsSpeakMode === "tool") {
    lines.splice(
      1,
      1,
      "User-visible chat is the assistant message body (markdown, code, tables). Spoken lines must use the character_speak tool — they are not inferred from the body.",
    );
  }

  if (isGroup && roster.length) {
    lines.push(
      `This is a GROUP room with multiple agents present: ${roster.map((s) => `@${s}`).join(", ")}. You are @${opts.agentSlug}.`,
      "You are not alone. Other agents can hear this conversation.",
      "Do not claim you are the only agent here.",
      "Peer agent lines in history are prefixed with their @slug; those are not your own prior words.",
    );
    if (primary) {
      lines.push(
        `Default primary responder for unmentioned human messages: @${primary}.`,
      );
    }
    if (replyPolicy === "mentioned_only") {
      lines.push(
        "Reply policy: mentioned_only — you must wait for an explicit @mention (or @all/@room) before the controller invokes you. Do not assume you auto-reply.",
      );
    } else {
      lines.push(
        "Reply policy: peers do not answer unless @mentioned or the human used @all/@room.",
        "To pull another agent into the conversation, write their @slug in your reply; the controller will invoke them (budget-limited).",
        "Aliases @all and @room address every agent in the room.",
      );
    }
  }

  if (opts.identity.verified) {
    lines.push(
      `Verified human on this channel: ${opts.identity.displayName} <${opts.identity.email}> (user_id=${opts.identity.userId}).`,
      "This is exactly that person — not an anonymous visitor. Treat them as your known owner/operator for this portal login.",
      "Other portal accounts are NOT automatically verified; only this matched identity is.",
    );
  } else {
    lines.push(
      "Human identity: UNVERIFIED / unknown visitor on oc-controller.",
      "Use your PUBLIC professional profile only.",
      "Do NOT discuss private/internal context, unpublished operational details, or off-duty personality.",
      "No roleplay register. Be neutral, concise, and work-focused.",
    );
    if (opts.identity.email) {
      lines.push(`Portal login email (unverified for agent trust): ${opts.identity.email}.`);
    }
  }

  if (opts.viewport3dActive) {
    lines.push(
      formatViewportMotionPrompt({
        selfSlug: opts.agentSlug,
        roster,
        occupants: opts.sceneOccupants || [],
      }),
    );
  }

  if (opts.ttsSpeakMode === "tool") {
    lines.push(formatCharacterSpeakPrompt());
  }

  return lines.join("\n");
}
