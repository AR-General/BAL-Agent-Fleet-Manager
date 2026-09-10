import { fetchWithTls, type FetchTlsOptions } from "../utils/httpFetch.js";
import { isRetryableNetworkError } from "../utils/instanceEndpoints.js";
import { incMetric } from "../utils/metrics.js";
import { log } from "../utils/logger.js";

export class HermesConfigError extends Error {
  code = "hermes_config" as const;
  constructor(message: string) {
    super(message);
    this.name = "HermesConfigError";
  }
}

export class HermesAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HermesAuthError";
  }
}

export type HermesToolCallMessage = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type HermesMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  /** Assistant echo of OpenAI-style tool_calls for multi-round tool loops. */
  tool_calls?: HermesToolCallMessage[];
};

export type HermesCompletionResult = {
  content: string;
  model?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;
  toolCalls?: HermesToolCall[];
};

export type HermesToolProgress = {
  tool?: string;
  emoji?: string;
  label?: string;
  toolCallId?: string;
  status?: string;
};

export type HermesToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type HermesStreamHandlers = {
  onDelta?: (text: string) => void;
  /** Reasoning tokens — never mixed into assistant content. */
  onReasoningDelta?: (text: string) => void;
  onToolProgress?: (progress: HermesToolProgress) => void;
  onToolCall?: (call: HermesToolCall) => void;
  onStatus?: (status: { state: string; emoji?: string; label?: string }) => void;
};

function apiRoot(baseUrl: string): string {
  const u = baseUrl.replace(/\/$/, "");
  return u.endsWith("/v1") ? u : `${u}/v1`;
}

function hermesBaseUrls(opts: { baseUrl?: string; baseUrls?: string[] }): string[] {
  const listed = (opts.baseUrls || []).map((u) => u.trim()).filter(Boolean);
  if (listed.length) return [...new Set(listed)];
  const single = (opts.baseUrl || "").trim();
  return single ? [single] : [];
}

async function withHermesUrlFallback<T>(
  bases: string[],
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  if (!bases.length) throw new HermesConfigError("Hermes base URL missing");
  let lastErr: unknown;
  for (let i = 0; i < bases.length; i++) {
    try {
      const result = await fn(bases[i]);
      if (i > 0) {
        log.warn(
          { baseUrl: bases[i], attempted: bases.slice(0, i) },
          "hermes request succeeded on fallback endpoint",
        );
        incMetric("oc_hermes_endpoint_fallback_total", "Hermes calls that succeeded on a fallback host");
      }
      return result;
    } catch (e) {
      lastErr = e;
      if (e instanceof HermesAuthError || e instanceof HermesConfigError) throw e;
      if (i === bases.length - 1 || !isRetryableNetworkError(e)) throw e;
      log.warn({ err: e, from: bases[i], to: bases[i + 1] }, "hermes endpoint failed, trying fallback");
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function parseToolProgress(raw: unknown): HermesToolProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    tool: typeof o.tool === "string" ? o.tool : undefined,
    emoji: typeof o.emoji === "string" ? o.emoji : undefined,
    label: typeof o.label === "string" ? o.label : undefined,
    toolCallId:
      typeof o.toolCallId === "string"
        ? o.toolCallId
        : typeof o.tool_call_id === "string"
          ? o.tool_call_id
          : undefined,
    status: typeof o.status === "string" ? o.status : undefined,
  };
}

function inferStatusFromLabel(label: string): string | null {
  const l = label.toLowerCase();
  if (/\bthink/.test(l)) return "thinking";
  if (/\bplan/.test(l)) return "planning";
  if (/\bread|recall|search|browse|fetch|load/.test(l)) return "reading";
  if (/\breason/.test(l)) return "reasoning";
  if (/\bwrit|edit|patch|code/.test(l)) return "writing";
  if (/\brun|exec|shell|terminal|command/.test(l)) return "running";
  return null;
}

export async function hermesChatCompletion(opts: {
  baseUrl?: string;
  baseUrls?: string[];
  apiKey: string;
  messages: HermesMessage[];
  model?: string;
  provider?: string;
  stream?: false;
  timeoutMs?: number;
  /** Hermes agent.max_turns / max_iterations for this generation. */
  maxIterations?: number;
  tls?: FetchTlsOptions;
  signal?: AbortSignal;
}): Promise<HermesCompletionResult> {
  return withHermesUrlFallback(hermesBaseUrls(opts), async (baseUrl) => {
    const url = `${apiRoot(baseUrl)}/chat/completions`;
    const maxIterations = Number.isFinite(opts.maxIterations) ? Math.floor(opts.maxIterations!) : undefined;
    const body = JSON.stringify({
      model: opts.model || "default",
      messages: opts.messages,
      stream: false,
      ...(opts.provider ? { provider: opts.provider } : {}),
      ...(maxIterations ? { max_iterations: maxIterations, max_turns: maxIterations } : {}),
    });
    const res = await fetchWithTls(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        ...(maxIterations ? { "X-Hermes-Max-Iterations": String(maxIterations) } : {}),
      },
      body,
      timeoutMs: opts.timeoutMs ?? 120_000,
      allowSelfSigned: opts.tls?.allowSelfSigned,
    });
    if (res.status === 401 || res.status === 403) {
      throw new HermesAuthError(`Hermes auth failed: HTTP ${res.status}`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hermes completion failed: HTTP ${res.status} ${text.slice(0, 400)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      model?: string;
      usage?: Record<string, unknown>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    return {
      content,
      model: json.model,
      finishReason: json.choices?.[0]?.finish_reason,
      usage: json.usage,
    };
  });
}

/** Stream SSE chunks; keeps reasoning / tool progress off the assistant content. */
export async function hermesChatCompletionStream(opts: {
  baseUrl?: string;
  baseUrls?: string[];
  apiKey: string;
  messages: HermesMessage[];
  model?: string;
  provider?: string;
  timeoutMs?: number;
  /** Hermes agent.max_turns / max_iterations for this generation. */
  maxIterations?: number;
  /** OpenAI-compatible tools array (e.g. character_speak). Omitted when empty. */
  tools?: Array<Record<string, unknown>>;
  tls?: FetchTlsOptions;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  /** Ask OpenAI-compat providers to include usage on the last SSE chunk. */
  includeUsage?: boolean;
} & HermesStreamHandlers): Promise<HermesCompletionResult> {
  const bases = hermesBaseUrls(opts);
  if (!bases.length) throw new HermesConfigError("Hermes base URL missing");
  const maxIterations = Number.isFinite(opts.maxIterations) ? Math.floor(opts.maxIterations!) : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 120_000,
  );
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timeout);
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const toolCalls = new Map<number, HermesToolCall>();

  try {
    let res: Response | undefined;
    let lastFetchErr: unknown;
    for (let i = 0; i < bases.length; i++) {
      const url = `${apiRoot(bases[i])}/chat/completions`;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(maxIterations ? { "X-Hermes-Max-Iterations": String(maxIterations) } : {}),
          },
          body: JSON.stringify({
            model: opts.model || "default",
            messages: opts.messages,
            stream: true,
            ...(opts.provider ? { provider: opts.provider } : {}),
            ...(opts.includeUsage ? { stream_options: { include_usage: true } } : {}),
            ...(maxIterations ? { max_iterations: maxIterations, max_turns: maxIterations } : {}),
            ...(opts.tools?.length ? { tools: opts.tools } : {}),
          }),
          signal: controller.signal,
        });
        if (res.status === 401 || res.status === 403) {
          throw new HermesAuthError(`Hermes auth failed: HTTP ${res.status}`);
        }
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(`Hermes stream failed: HTTP ${res.status} ${text.slice(0, 400)}`);
        }
        if (i > 0) {
          log.warn(
            { baseUrl: bases[i], attempted: bases.slice(0, i) },
            "hermes stream succeeded on fallback endpoint",
          );
          incMetric("oc_hermes_endpoint_fallback_total", "Hermes calls that succeeded on a fallback host");
        }
        lastFetchErr = undefined;
        break;
      } catch (e) {
        lastFetchErr = e;
        if (e instanceof HermesAuthError) throw e;
        if (i === bases.length - 1 || !isRetryableNetworkError(e) || controller.signal.aborted) {
          throw e;
        }
        log.warn({ err: e, from: bases[i], to: bases[i + 1] }, "hermes stream endpoint failed, trying fallback");
      }
    }
    if (!res?.body) {
      throw lastFetchErr instanceof Error ? lastFetchErr : new Error("Hermes stream failed");
    }

    opts.onStatus?.({ state: "thinking", emoji: "🤔", label: "thinking" });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let model: string | undefined;
    let finishReason: string | undefined;
    let eventName = "";

    let usage: Record<string, unknown> | undefined;

    const handleDataPayload = (data: string, namedEvent: string) => {
      if (data === "[DONE]") return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }

      const isToolProgress =
        namedEvent === "hermes.tool.progress" ||
        (parsed &&
          typeof parsed === "object" &&
          ("tool" in (parsed as object) || "emoji" in (parsed as object)) &&
          !("choices" in (parsed as object)));

      if (isToolProgress) {
        const progress = parseToolProgress(parsed);
        if (!progress) return;
        opts.onToolProgress?.(progress);
        const state =
          inferStatusFromLabel(`${progress.label || ""} ${progress.tool || ""}`) ||
          (progress.status === "running" ? "running" : "planning");
        opts.onStatus?.({
          state,
          emoji: progress.emoji || "⚙️",
          label: progress.label || progress.tool || state,
        });
        return;
      }

      const chunk = parsed as {
        model?: string;
        usage?: Record<string, unknown>;
        choices?: Array<{
          delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string | null;
        }>;
      };

      if (chunk.model) model = chunk.model;
      if (chunk.usage && typeof chunk.usage === "object") usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;

      const delta = choice.delta;
      if (delta?.reasoning_content || delta?.reasoning) {
        const reasoning = String(delta.reasoning_content || delta.reasoning || "");
        if (reasoning) {
          opts.onReasoningDelta?.(reasoning);
          opts.onStatus?.({ state: "reasoning", emoji: "🧠", label: "reasoning" });
        }
      }

          if (delta?.content) {
            // Strip accidental think-blocks if a model dumps them into content.
            let piece = delta.content;
            if (piece.includes("<think>") || piece.includes("</think>")) {
              piece = piece.replace(/<think>[\s\S]*?<\/think>/gi, "");
            }
            if (piece) {
              full += piece;
              opts.onDelta(piece);
              opts.onStatus?.({ state: "writing", emoji: "✍️", label: "writing" });
            }
          }

      if (delta?.tool_calls?.length) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const existing = toolCalls.get(idx) || {
            id: tc.id || `call_${idx}`,
            name: "",
            arguments: "",
          };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCalls.set(idx, existing);
          if (existing.name) {
            opts.onToolCall?.(existing);
            opts.onStatus?.({
              state: "planning",
              emoji: "🛠️",
              label: existing.name,
            });
          }
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason || undefined;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed) {
          eventName = "";
          continue;
        }
        if (trimmed.startsWith("event:")) {
          eventName = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        handleDataPayload(data, eventName);
      }
    }

    opts.onStatus?.({ state: "done", emoji: "✅", label: "done" });

    return {
      content: full,
      model,
      finishReason,
      usage,
      toolCalls: [...toolCalls.values()].filter((t) => t.name),
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      log.info("Hermes stream aborted");
      opts.onStatus?.({ state: "cancelled", emoji: "⏹️", label: "cancelled" });
      throw e;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
