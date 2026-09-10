import { log } from "../utils/logger.js";
import { fetchWithTls } from "../utils/httpFetch.js";
import type { InstanceTls } from "../utils/instanceTls.js";

export type ChatMessage = { role: string; content: string };

export type ChatCompletionResult = {
  content: string;
  model: string;
  finishReason?: string;
  usage?: Record<string, unknown>;
  raw: unknown;
};

export class GatewayAuthError extends Error {
  constructor(message = "OpenClaw gateway rejected the request (check gateway token)") {
    super(message);
    this.name = "GatewayAuthError";
  }
}

export class GatewayConfigError extends Error {
  constructor(
    message = "No gateway token configured for this instance",
    readonly code = "gateway_token_missing",
  ) {
    super(message);
    this.name = "GatewayConfigError";
  }
}

/** Gateway requires openclaw or openclaw/<agentId>; not provider model ids. */
export function resolveCompletionModel(model: string | undefined, agentId = "main"): string {
  const raw = (model || "").trim();
  if (!raw) return `openclaw/${agentId}`;
  if (raw === "openclaw") return raw;
  if (raw.startsWith("openclaw/")) return raw;
  if (raw.includes("/")) {
    log.warn({ configured: raw, fallback: `openclaw/${agentId}` }, "openclaw model id normalized");
    return `openclaw/${agentId}`;
  }
  return `openclaw/${raw}`;
}

function extractMessageContent(data: Record<string, unknown>): string {
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  if (!choices?.length) return "";
  const message = (choices[0].message || {}) as Record<string, unknown>;
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
      .map((p) => String(p.text ?? ""))
      .join("");
  }
  return "";
}

export async function openclawChatCompletion(opts: {
  baseUrl: string;
  gatewayToken: string;
  messages: ChatMessage[];
  model?: string;
  agentId?: string;
  sessionUser?: string;
  stream?: boolean;
  tls?: Pick<InstanceTls, "allow_self_signed">;
  timeoutMs?: number;
}): Promise<ChatCompletionResult> {
  const token = opts.gatewayToken.trim();
  if (!token) {
    throw new GatewayConfigError();
  }

  const base = opts.baseUrl.replace(/\/$/, "");
  const model = resolveCompletionModel(opts.model, opts.agentId ?? "main");
  const url = `${base}/v1/chat/completions`;
  const body = {
    model,
    messages: opts.messages,
    stream: opts.stream ?? false,
    ...(opts.sessionUser ? { user: opts.sessionUser } : {}),
  };

  const r = await fetchWithTls(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    allowSelfSigned: opts.tls?.allow_self_signed ?? false,
    timeoutMs: opts.timeoutMs ?? 120_000,
  });

  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* keep raw text */
  }

  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      throw new GatewayAuthError(
        typeof parsed === "object" && parsed && "error" in (parsed as object)
          ? String((parsed as { error?: unknown }).error)
          : `HTTP ${r.status}`,
      );
    }
    const detail =
      typeof parsed === "object" && parsed && "error" in (parsed as object)
        ? JSON.stringify((parsed as { error?: unknown }).error)
        : text.slice(0, 500);
    throw new Error(`OpenClaw gateway error ${r.status}: ${detail}`);
  }

  const data = (typeof parsed === "object" && parsed ? parsed : {}) as Record<string, unknown>;
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const finishReason = choices?.[0]?.finish_reason as string | undefined;

  return {
    content: extractMessageContent(data),
    model: String(data.model || model),
    finishReason,
    usage: data.usage as Record<string, unknown> | undefined,
    raw: parsed,
  };
}
