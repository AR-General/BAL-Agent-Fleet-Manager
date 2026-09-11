/** Provider prefix → small icon + display helpers for the chat Model picker. */

export type ModelProviderInfo = {
  /** Prefix before first `/` (e.g. deepseek). */
  prefix: string;
  /** Short label for tooltip when unknown. */
  label: string;
  /** CSS color for letter badge / icon accent. */
  color: string;
  /** Optional remote favicon/logo URL (small). */
  iconUrl?: string;
};

const PROVIDERS: Record<string, Omit<ModelProviderInfo, "prefix">> = {
  deepseek: {
    label: "DeepSeek",
    color: "#4d6bfe",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/deepseek.png",
  },
  openai: {
    label: "OpenAI",
    color: "#10a37f",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/openai.png",
  },
  anthropic: {
    label: "Anthropic",
    color: "#d4a27f",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/anthropic.png",
  },
  google: {
    label: "Google",
    color: "#4285f4",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/gemini-color.png",
  },
  "meta-llama": {
    label: "Meta",
    color: "#0668e1",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/meta-color.png",
  },
  meta: {
    label: "Meta",
    color: "#0668e1",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/meta-color.png",
  },
  mistralai: {
    label: "Mistral",
    color: "#ff7000",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/mistral.png",
  },
  mistral: {
    label: "Mistral",
    color: "#ff7000",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/mistral.png",
  },
  qwen: {
    label: "Qwen",
    color: "#615ced",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/qwen-color.png",
  },
  xai: {
    label: "xAI",
    color: "#e8e8e8",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/xai.png",
  },
  cohere: {
    label: "Cohere",
    color: "#39594d",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/cohere-color.png",
  },
  perplexity: {
    label: "Perplexity",
    color: "#22b8cd",
    iconUrl: "https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@latest/packages/static-png/dark/perplexity-color.png",
  },
  amazon: {
    label: "Amazon",
    color: "#ff9900",
  },
  microsoft: {
    label: "Microsoft",
    color: "#00a4ef",
  },
  nvidia: {
    label: "NVIDIA",
    color: "#76b900",
  },
};

const RECENT_KEY = "oc-chat-model-recent";
const RECENT_MAX = 5;

/** Strip gateway prefixes like `openrouter:` before reading author/model. */
export function stripGatewayPrefix(modelId: string): string {
  const s = modelId.trim();
  const colon = s.indexOf(":");
  if (colon > 0 && !s.slice(0, colon).includes("/")) {
    return s.slice(colon + 1);
  }
  return s;
}

export function modelProviderPrefix(modelId: string): string {
  const core = stripGatewayPrefix(modelId);
  const slash = core.indexOf("/");
  if (slash <= 0) return "";
  return core.slice(0, slash).toLowerCase();
}

/** Leaf model name only (no author/). */
export function modelDisplayName(modelId: string): string {
  const core = stripGatewayPrefix(modelId);
  const slash = core.lastIndexOf("/");
  return slash >= 0 ? core.slice(slash + 1) : core || modelId;
}

export function resolveModelProvider(modelId: string): ModelProviderInfo {
  const prefix = modelProviderPrefix(modelId);
  if (!prefix) {
    return { prefix: "", label: "Model", color: "#8a96a3" };
  }
  const known = PROVIDERS[prefix];
  if (known) return { prefix, ...known };
  return {
    prefix,
    label: prefix,
    color: hashColor(prefix),
  };
}

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 42% 55%)`;
}

export function readRecentModelIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x || "").trim()).filter(Boolean).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function rememberModelUsage(modelId: string): string[] {
  const id = modelId.trim();
  if (!id) return readRecentModelIds();
  const next = [id, ...readRecentModelIds().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
