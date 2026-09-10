/** Classify instance identity.runtime for chat completions and model lists. */

export type BotRuntimeKind = "openclaw" | "hermes" | "openai-like";

export function normalizeRuntime(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

export function classifyBotRuntime(raw: unknown): BotRuntimeKind {
  const runtime = normalizeRuntime(raw);
  if (runtime === "hermes" || runtime.startsWith("hermes-")) return "hermes";
  if (runtime === "openclaw" || runtime === "oc" || runtime === "") return "openclaw";
  return "openai-like";
}

export function usesOpenAiCompatChat(raw: unknown): boolean {
  const kind = classifyBotRuntime(raw);
  return kind === "hermes" || kind === "openclaw" || kind === "openai-like";
}

export function shouldRequestStreamUsage(raw: unknown): boolean {
  return classifyBotRuntime(raw) !== "openclaw";
}
