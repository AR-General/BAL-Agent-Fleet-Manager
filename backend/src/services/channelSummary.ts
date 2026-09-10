import {
  INSTANCE_CHANNEL_META,
  PUB_URL_KEYS,
  type InstanceChannelType,
} from "../constants/instanceChannels.js";

function maskSecret(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
}

function formatListSummary(values: string[]): string | null {
  const parts = values.map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0].length > 40 ? `${parts[0].slice(0, 37)}…` : parts[0];
  if (parts.length === 1) return first;
  return `${first} (+${parts.length - 1})`;
}

function pickSummary(config: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = config[key];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      const listed = formatListSummary(v.map(String));
      if (listed) return listed;
      continue;
    }
    const s = String(v);
    if (/token|secret|password|bridgeToken/i.test(key)) return maskSecret(s);
    return s.length > 48 ? `${s.slice(0, 45)}…` : s;
  }
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === "string" && v && !/secret|token|password/i.test(k)) {
      return v.length > 48 ? `${v.slice(0, 45)}…` : v;
    }
  }
  return null;
}

export function summarizeChannelConfig(
  channelType: string,
  config: Record<string, unknown>,
): string | null {
  const meta = INSTANCE_CHANNEL_META[channelType as InstanceChannelType];
  if (!meta) return pickSummary(config, []);
  return pickSummary(config, meta.summaryKeys);
}

export function summarizePubUrls(
  config: Record<string, unknown>,
  instanceUrls: Record<string, string>,
): string | null {
  const fromConfig = summarizeChannelConfig("pub_urls", config);
  if (fromConfig) return fromConfig;
  const parts: string[] = [];
  for (const key of PUB_URL_KEYS) {
    const u = instanceUrls[key];
    if (u) parts.push(`${key}: ${u}`);
  }
  if (parts.length === 0) return null;
  const first = parts[0];
  if (parts.length === 1) return first;
  return `${first} (+${parts.length - 1})`;
}
