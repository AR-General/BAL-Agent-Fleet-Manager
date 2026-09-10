import type { LlmModelOption } from "./llmModels";

export type LlmMetaRow = {
  key: string;
  slug: string;
  name: string;
  intelligence: number | null;
  intelligence_estimated?: boolean;
  input_per_m: number | null;
  output_per_m: number | null;
};

export type EnrichedLlmOption = LlmModelOption & {
  intelligence: number | null;
  input_per_m: number | null;
  output_per_m: number | null;
};

export function normalizeModelKey(id: string): string {
  let s = id.trim().toLowerCase();
  const colon = s.indexOf(":");
  if (colon >= 0 && !s.slice(0, colon).includes("/")) {
    s = s.slice(colon + 1);
  }
  return s.replace(/:(batch|free|nitro|floor|extended)$/i, "");
}

export function matchKeysForModelId(id: string): string[] {
  const full = normalizeModelKey(id);
  const keys = new Set<string>([full]);
  const slash = full.lastIndexOf("/");
  const leaf = slash >= 0 ? full.slice(slash + 1) : full;
  keys.add(leaf);
  keys.add(leaf.replace(/[^a-z0-9]+/g, "-"));
  keys.add(leaf.replace(/\./g, "-"));
  return [...keys].filter(Boolean);
}

export function lookupLlmMeta(modelId: string, rows: LlmMetaRow[]): LlmMetaRow | null {
  const keys = matchKeysForModelId(modelId);
  const candidates = rows.filter((r) =>
    keys.some(
      (key) =>
        r.key === key ||
        r.key.endsWith(`/${key}`) ||
        key.endsWith(`/${r.key}`) ||
        r.key.endsWith(key) ||
        key.endsWith(r.key),
    ),
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const score = (r: LlmMetaRow) =>
      (r.intelligence != null ? 4 : 0) + (r.input_per_m != null ? 2 : 0) + (r.key.includes("/") ? 1 : 0);
    return score(b) - score(a);
  });
  const best = { ...candidates[0]! };
  for (const c of candidates.slice(1)) {
    if (best.intelligence == null && c.intelligence != null) {
      best.intelligence = c.intelligence;
      best.intelligence_estimated = c.intelligence_estimated;
    }
    if (best.input_per_m == null && c.input_per_m != null) {
      best.input_per_m = c.input_per_m;
      best.output_per_m = c.output_per_m;
    }
  }
  return best;
}

export function enrichLlmOptions(
  models: LlmModelOption[],
  rows: LlmMetaRow[],
): EnrichedLlmOption[] {
  return models.map((m) => {
    const meta = lookupLlmMeta(m.id, rows);
    return {
      ...m,
      intelligence: meta?.intelligence ?? null,
      input_per_m: meta?.input_per_m ?? null,
      output_per_m: meta?.output_per_m ?? null,
    };
  });
}

export function formatUsdPerM(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "free";
  if (value < 0.01) return `$${value.toFixed(3)}`;
  if (value < 1) return `$${value.toFixed(2)}`;
  if (value < 10) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(1)}`;
}

export function formatIntelScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

/** Cheap → expensive color band for $/M tokens. */
export function priceTone(value: number | null | undefined): "free" | "low" | "mid" | "high" | "unknown" {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value <= 0) return "free";
  if (value < 0.5) return "low";
  if (value < 5) return "mid";
  return "high";
}

/** Low → high intelligence color band (Artificial Analysis index). */
export function intelTone(value: number | null | undefined): "low" | "mid" | "high" | "top" | "unknown" {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value < 15) return "low";
  if (value < 30) return "mid";
  if (value < 45) return "high";
  return "top";
}
