export type BotRuntimeKind = "openclaw" | "hermes" | "openai-like";

export function classifyBotRuntime(raw: unknown): BotRuntimeKind {
  const runtime = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (runtime === "hermes" || runtime.startsWith("hermes-")) return "hermes";
  if (runtime === "openclaw" || runtime === "oc" || runtime === "") return "openclaw";
  return "openai-like";
}

export const RUNTIME_LABELS: Record<BotRuntimeKind, string> = {
  openclaw: "OpenClaw",
  hermes: "Hermes",
  "openai-like": "OpenAI-like",
};
