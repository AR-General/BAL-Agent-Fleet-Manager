import { parseMentionTokens } from "./chatReplyTargets.js";
import {
  fetchInstanceHealthDetailed,
  listInstanceLlmModels,
  resolveModelQuery,
  type LlmModelOption,
} from "./instanceModels.js";
import { classifyBotRuntime } from "./botRuntime.js";
import { log } from "../utils/logger.js";
import { incMetric } from "../utils/metrics.js";

export type ParsedSlashCommand = {
  name: string;
  args: string;
  mentionSlugs: string[];
};

const COMMAND_RE =
  /^(?:(@[a-zA-Z0-9][a-zA-Z0-9_-]*\s+)+)?\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/;

/** True when the whole message is a slash command (optional leading @mentions). */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") && !trimmed.startsWith("@")) return null;
  const m = trimmed.match(COMMAND_RE);
  if (!m) return null;
  const name = (m[2] || "").toLowerCase();
  if (!name) return null;
  const args = (m[3] || "").trim();
  return {
    name,
    args,
    mentionSlugs: parseMentionTokens(trimmed).slugs,
  };
}

export const SLASH_HELP = [
  "Commands are handled here instead of being sent to the LLM as chat.",
  "/status — runtime, selected model, and agent health",
  "/model — list LLMs available to this agent",
  "/model <name> — switch this agent's LLM for the session (e.g. /model sonnet)",
  "/help — this list",
].join("\n");

function formatModelList(models: LlmModelOption[], current: string | null, limit = 30): string {
  if (!models.length) {
    return "No LLM catalog is available for this agent (Hermes `/v1/models` only advertises the agent name).";
  }
  const shown = models.slice(0, limit);
  const lines = shown.map((m) => {
    const mark = current && m.id === current ? " *" : "";
    const label = m.label && m.label !== m.id ? m.label : m.id.includes(":") ? m.id.slice(m.id.indexOf(":") + 1) : m.id;
    const provider = m.owned_by ? ` · ${m.owned_by}` : "";
    return `- ${label}${provider}${mark}`;
  });
  const extra = models.length > limit ? `\n…and ${models.length - limit} more (use the Model dropdown).` : "";
  return `Current: ${current || "(agent default)"}\n${lines.join("\n")}${extra}`;
}

export async function runSlashCommand(opts: {
  cmd: ParsedSlashCommand;
  inst: {
    id: string;
    slug: string;
    identity?: unknown;
    urls?: unknown;
    tls?: unknown;
    gatewayTokenEncrypted?: string | null;
  };
  currentModelId: string | null;
}): Promise<{ text: string; nextModelId?: string }> {
  const { cmd, inst, currentModelId } = opts;
  const identity = (inst.identity || {}) as Record<string, unknown>;
  const runtime = String(identity.runtime || "unknown");

  if (cmd.name === "help") {
    return { text: SLASH_HELP };
  }

  if (cmd.name === "new" || cmd.name === "reset") {
    return {
      text: "This chat keeps history in oc-controller. Hermes `/new` does not apply here — start a new session from the sidebar.",
    };
  }

  if (cmd.name === "status") {
    const health = await fetchInstanceHealthDetailed(inst);
    const healthStatus =
      health && typeof health.status === "string" ? health.status : health ? "ok" : "unknown";
    const lines = [
      `Agent: @${inst.slug}`,
      `Runtime: ${classifyBotRuntime(runtime)} (${runtime})`,
      `Selected model: ${currentModelId || "(Hermes / agent default)"}`,
      `Health: ${healthStatus}`,
    ];
    log.info({ slug: inst.slug, command: "status", health: healthStatus }, "slash command /status");
    incMetric("oc_chat_slash_command_total", "Slash commands handled in oc-controller");
    return { text: lines.join("\n") };
  }

  if (cmd.name === "model") {
    const catalog = await listInstanceLlmModels(inst);
    if (!cmd.args) {
      incMetric("oc_chat_slash_command_total", "Slash commands handled in oc-controller");
      const header = catalog.error && !catalog.models.length ? `${catalog.error}\n` : "";
      return { text: header + formatModelList(catalog.models, currentModelId) };
    }
    const query = cmd.args.replace(/^--\w+\s*/g, "").trim();
    const pick = resolveModelQuery(query, catalog.models);
    if (!pick) {
      return {
        text: `No model matching "${query}".\n${formatModelList(catalog.models, currentModelId)}`,
      };
    }
    log.info({ slug: inst.slug, command: "model", model: pick.id }, "slash command /model switch");
    incMetric("oc_chat_slash_command_total", "Slash commands handled in oc-controller");
    return {
      text: `Model set to ${pick.label || pick.id}${pick.owned_by ? ` (${pick.owned_by})` : ""} for @${inst.slug}.`,
      nextModelId: pick.id,
    };
  }

  return { text: `Unknown command /${cmd.name}.\n${SLASH_HELP}` };
}
