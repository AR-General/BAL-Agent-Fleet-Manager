export type NormalizedTokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  estimated: boolean;
  model?: string;
};

export type ParticipantTokenSpend = {
  slug: string;
  usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  calls: number;
  estimated: boolean;
};

export type SessionTokenSpend = {
  total_usd: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  estimated: boolean;
  participants: ParticipantTokenSpend[];
};

function asFiniteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Rough USD per 1M tokens when the provider does not return `cost`. */
export function estimateUsdFromTokens(
  promptTokens: number,
  completionTokens: number,
  model?: string,
): number {
  const id = (model || "").toLowerCase();
  let inPerM = 1;
  let outPerM = 3;
  if (/\bopus\b/.test(id)) {
    inPerM = 15;
    outPerM = 75;
  } else if (/\bsonnet\b/.test(id)) {
    inPerM = 3;
    outPerM = 15;
  } else if (/\bhaiku\b/.test(id)) {
    inPerM = 0.25;
    outPerM = 1.25;
  } else if (/\bgpt-4o-mini\b/.test(id) || /\bgpt-4\.1-mini\b/.test(id)) {
    inPerM = 0.15;
    outPerM = 0.6;
  } else if (/\bgpt-4o\b/.test(id) || /\bgpt-4\.1\b/.test(id)) {
    inPerM = 2.5;
    outPerM = 10;
  }
  return (Math.max(0, promptTokens) * inPerM + Math.max(0, completionTokens) * outPerM) / 1_000_000;
}

export function parseTokenUsage(raw: unknown, model?: string): NormalizedTokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const prompt = asFiniteNumber(o.prompt_tokens ?? o.promptTokens ?? o.input_tokens);
  const completion = asFiniteNumber(o.completion_tokens ?? o.completionTokens ?? o.output_tokens);
  const total = asFiniteNumber(o.total_tokens ?? o.totalTokens) || prompt + completion;
  const reportedCost = asFiniteNumber(
    o.cost ?? o.total_cost ?? o.total_cost_usd ?? o.cost_usd ?? o.costUsd,
  );
  if (!prompt && !completion && !total && !reportedCost) return null;

  const modelId = typeof o.model === "string" && o.model.trim() ? o.model : model;
  const estimated = reportedCost <= 0 && (prompt > 0 || completion > 0);
  const cost_usd = reportedCost > 0 ? reportedCost : estimateUsdFromTokens(prompt, completion, modelId);

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    cost_usd,
    estimated,
    model: modelId,
  };
}

export function aggregateTokenSpend(
  rows: Array<{ slug: string; usage: NormalizedTokenUsage | null }>,
): SessionTokenSpend {
  const bySlug = new Map<string, ParticipantTokenSpend>();
  for (const row of rows) {
    if (!row.usage) continue;
    const slug = row.slug.trim() || "unknown";
    const prev = bySlug.get(slug) || {
      slug,
      usd: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      calls: 0,
      estimated: false,
    };
    prev.usd += row.usage.cost_usd;
    prev.prompt_tokens += row.usage.prompt_tokens;
    prev.completion_tokens += row.usage.completion_tokens;
    prev.calls += 1;
    prev.estimated = prev.estimated || row.usage.estimated;
    bySlug.set(slug, prev);
  }

  const participants = [...bySlug.values()].sort((a, b) => b.usd - a.usd);
  for (const p of participants) {
    p.usd = Math.round(p.usd * 1e6) / 1e6;
  }
  return {
    total_usd: Math.round(participants.reduce((sum, p) => sum + p.usd, 0) * 1e6) / 1e6,
    total_prompt_tokens: participants.reduce((sum, p) => sum + p.prompt_tokens, 0),
    total_completion_tokens: participants.reduce((sum, p) => sum + p.completion_tokens, 0),
    estimated: participants.some((p) => p.estimated),
    participants,
  };
}
