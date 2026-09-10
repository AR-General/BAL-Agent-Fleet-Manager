import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { log } from "../utils/logger.js";
import { fetchWithTls } from "../utils/httpFetch.js";

export type LlmMetaRow = {
  /** Normalized match key (lowercase, no provider prefix). */
  key: string;
  slug: string;
  name: string;
  /** Artificial Analysis Intelligence Index (0–100-ish). */
  intelligence: number | null;
  intelligence_estimated?: boolean;
  /** USD per 1M input tokens. */
  input_per_m: number | null;
  /** USD per 1M output tokens. */
  output_per_m: number | null;
  source_intelligence?: string;
  source_pricing?: string;
};

export type LlmMetaPayload = {
  updated_at: string;
  attribution: { intelligence: string; pricing: string };
  models: LlmMetaRow[];
  live: { artificial_analysis: boolean; openrouter: boolean };
};

type SnapshotFile = {
  updated_at?: string;
  attribution?: { intelligence?: string; pricing?: string };
  intelligence?: Array<{
    slug: string;
    name?: string;
    intelligence: number;
    estimated?: boolean;
  }>;
  pricing?: Array<{
    id: string;
    name?: string;
    input_per_m: number;
    output_per_m: number;
  }>;
};

const ATTRIBUTION = {
  intelligence: "https://artificialanalysis.ai/",
  pricing: "https://openrouter.ai/",
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { at: number; payload: LlmMetaPayload } | null = null;

function snapshotPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "data", "llmModelMetaSnapshot.json");
}

function loadSnapshot(): SnapshotFile {
  try {
    return JSON.parse(readFileSync(snapshotPath(), "utf8")) as SnapshotFile;
  } catch (err) {
    log.warn({ err }, "llm meta snapshot missing or unreadable");
    return {};
  }
}

/** Lowercase id without openrouter:/provider: prefix and without :batch etc. */
export function normalizeModelKey(id: string): string {
  let s = id.trim().toLowerCase();
  const colon = s.indexOf(":");
  if (colon >= 0 && !s.slice(0, colon).includes("/")) {
    s = s.slice(colon + 1);
  }
  // drop openrouter-style modality suffixes after second colon rarely; strip :batch/:free
  s = s.replace(/:(batch|free|nitro|floor|extended)$/i, "");
  return s;
}

export function matchKeysForModelId(id: string): string[] {
  const full = normalizeModelKey(id);
  const keys = new Set<string>([full]);
  const slash = full.lastIndexOf("/");
  const leaf = slash >= 0 ? full.slice(slash + 1) : full;
  keys.add(leaf);
  // claude-sonnet-5 ↔ claude-sonnet-5-…
  keys.add(leaf.replace(/[^a-z0-9]+/g, "-"));
  // AA uses hyphens without org: gpt-4o, claude-sonnet-4
  keys.add(leaf.replace(/\./g, "-"));
  return [...keys].filter(Boolean);
}

function mergeRows(
  intelligence: SnapshotFile["intelligence"],
  pricing: SnapshotFile["pricing"],
): LlmMetaRow[] {
  const byKey = new Map<string, LlmMetaRow>();

  const upsert = (key: string, patch: Partial<LlmMetaRow> & { slug: string; name: string }) => {
    const prev = byKey.get(key);
    byKey.set(key, {
      key,
      slug: patch.slug || prev?.slug || key,
      name: patch.name || prev?.name || patch.slug || key,
      intelligence: patch.intelligence ?? prev?.intelligence ?? null,
      intelligence_estimated: patch.intelligence_estimated ?? prev?.intelligence_estimated,
      input_per_m: patch.input_per_m ?? prev?.input_per_m ?? null,
      output_per_m: patch.output_per_m ?? prev?.output_per_m ?? null,
      source_intelligence: patch.source_intelligence ?? prev?.source_intelligence,
      source_pricing: patch.source_pricing ?? prev?.source_pricing,
    });
  };

  for (const row of intelligence || []) {
    const key = normalizeModelKey(row.slug);
    upsert(key, {
      slug: row.slug,
      name: row.name || row.slug,
      intelligence: row.intelligence,
      intelligence_estimated: row.estimated,
      source_intelligence: ATTRIBUTION.intelligence,
    });
  }

  const pricingSorted = [...(pricing || [])].sort((a, b) => {
    // Prefer non-batch / non-free variants when writing the same key.
    const score = (id: string) => (/:(batch|free|nitro|floor)\b/i.test(id) ? 1 : 0);
    return score(a.id) - score(b.id);
  });

  for (const row of pricingSorted) {
    if (/:(batch|free|nitro|floor)\b/i.test(row.id)) continue;
    for (const key of matchKeysForModelId(row.id)) {
      upsert(key, {
        slug: row.id,
        name: row.name || row.id,
        input_per_m: row.input_per_m,
        output_per_m: row.output_per_m,
        source_pricing: ATTRIBUTION.pricing,
      });
    }
  }

  // Propagate AA leaf intelligence onto org/model pricing keys (and vice versa for prices).
  const rows = [...byKey.values()];
  for (const row of rows) {
    if (row.intelligence != null && row.input_per_m != null) continue;
    const leaf = row.key.includes("/") ? row.key.slice(row.key.lastIndexOf("/") + 1) : row.key;
    const donors = rows.filter(
      (r) =>
        r !== row &&
        (r.key === leaf ||
          r.key.endsWith(`/${leaf}`) ||
          leaf.endsWith(r.key) ||
          r.key === row.key),
    );
    for (const d of donors) {
      if (row.intelligence == null && d.intelligence != null) {
        row.intelligence = d.intelligence;
        row.intelligence_estimated = d.intelligence_estimated;
        row.source_intelligence = d.source_intelligence;
      }
      if (row.input_per_m == null && d.input_per_m != null) {
        row.input_per_m = d.input_per_m;
        row.output_per_m = d.output_per_m;
        row.source_pricing = d.source_pricing;
      }
    }
  }

  return rows.sort((a, b) => (b.intelligence || 0) - (a.intelligence || 0));
}

/** Resolve the best meta row for a Hermes/catalog model id. */
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
  const best = candidates[0]!;
  // Merge fields from other candidates when best is incomplete.
  for (const c of candidates.slice(1)) {
    if (best.intelligence == null && c.intelligence != null) {
      best.intelligence = c.intelligence;
      best.intelligence_estimated = c.intelligence_estimated;
      best.source_intelligence = c.source_intelligence;
    }
    if (best.input_per_m == null && c.input_per_m != null) {
      best.input_per_m = c.input_per_m;
      best.output_per_m = c.output_per_m;
      best.source_pricing = c.source_pricing;
    }
  }
  return best;
}

async function fetchOpenRouterPricing(): Promise<SnapshotFile["pricing"] | null> {
  try {
    const res = await fetchWithTls("https://openrouter.ai/api/v1/models", {
      timeoutMs: 20_000,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{ id?: string; name?: string; pricing?: { prompt?: string; completion?: string } }>;
    };
    const out: NonNullable<SnapshotFile["pricing"]> = [];
    for (const m of json.data || []) {
      if (!m.id) continue;
      const pin = Number(m.pricing?.prompt);
      const pout = Number(m.pricing?.completion);
      if (!Number.isFinite(pin) || !Number.isFinite(pout)) continue;
      out.push({
        id: m.id,
        name: m.name || m.id,
        input_per_m: Math.round(pin * 1_000_000 * 1e6) / 1e6,
        output_per_m: Math.round(pout * 1_000_000 * 1e6) / 1e6,
      });
    }
    return out.length ? out : null;
  } catch (err) {
    log.warn({ err }, "openrouter pricing fetch failed");
    return null;
  }
}

async function fetchArtificialAnalysis(): Promise<SnapshotFile["intelligence"] | null> {
  const key = (config.artificialAnalysisApiKey || "").trim();
  if (!key) return null;
  try {
    const res = await fetchWithTls("https://artificialanalysis.ai/api/v2/data/llms/models", {
      timeoutMs: 25_000,
      headers: { "x-api-key": key },
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "artificial analysis fetch failed");
      return null;
    }
    const json = (await res.json()) as {
      data?: Array<{
        name?: string;
        slug?: string;
        evaluations?: { artificial_analysis_intelligence_index?: number };
      }>;
    };
    const out: NonNullable<SnapshotFile["intelligence"]> = [];
    for (const m of json.data || []) {
      const score = m.evaluations?.artificial_analysis_intelligence_index;
      if (!m.slug || typeof score !== "number" || !Number.isFinite(score)) continue;
      out.push({
        slug: m.slug,
        name: m.name || m.slug,
        intelligence: score,
        estimated: false,
      });
    }
    return out.length ? out : null;
  } catch (err) {
    log.warn({ err }, "artificial analysis fetch error");
    return null;
  }
}

export async function getLlmModelMeta(opts?: { force?: boolean }): Promise<LlmMetaPayload> {
  if (!opts?.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.payload;
  }

  const snap = loadSnapshot();
  let intelligence = snap.intelligence || [];
  let pricing = snap.pricing || [];
  let liveAa = false;
  let liveOr = false;

  const [aa, or] = await Promise.all([fetchArtificialAnalysis(), fetchOpenRouterPricing()]);
  if (aa?.length) {
    intelligence = aa;
    liveAa = true;
  }
  if (or?.length) {
    pricing = or;
    liveOr = true;
  }

  const payload: LlmMetaPayload = {
    updated_at: new Date().toISOString(),
    attribution: ATTRIBUTION,
    models: mergeRows(intelligence, pricing),
    live: { artificial_analysis: liveAa, openrouter: liveOr },
  };
  cache = { at: Date.now(), payload };
  return payload;
}
