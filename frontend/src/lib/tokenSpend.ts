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

export const EMPTY_TOKEN_SPEND: SessionTokenSpend = {
  total_usd: 0,
  total_prompt_tokens: 0,
  total_completion_tokens: 0,
  estimated: false,
  participants: [],
};

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}M`;
}

export function normalizeTokenSpend(value: unknown): SessionTokenSpend {
  if (!value || typeof value !== "object") return EMPTY_TOKEN_SPEND;
  const rec = value as Record<string, unknown>;
  const rawParts = Array.isArray(rec.participants) ? rec.participants : [];
  const participants: ParticipantTokenSpend[] = rawParts
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const slug = typeof r.slug === "string" ? r.slug : "";
      if (!slug) return null;
      return {
        slug,
        usd: typeof r.usd === "number" && Number.isFinite(r.usd) ? r.usd : 0,
        prompt_tokens:
          typeof r.prompt_tokens === "number" && Number.isFinite(r.prompt_tokens) ? r.prompt_tokens : 0,
        completion_tokens:
          typeof r.completion_tokens === "number" && Number.isFinite(r.completion_tokens)
            ? r.completion_tokens
            : 0,
        calls: typeof r.calls === "number" && Number.isFinite(r.calls) ? r.calls : 0,
        estimated: r.estimated === true,
      };
    })
    .filter((row): row is ParticipantTokenSpend => Boolean(row));

  return {
    total_usd:
      typeof rec.total_usd === "number" && Number.isFinite(rec.total_usd) ? rec.total_usd : 0,
    total_prompt_tokens:
      typeof rec.total_prompt_tokens === "number" && Number.isFinite(rec.total_prompt_tokens)
        ? rec.total_prompt_tokens
        : 0,
    total_completion_tokens:
      typeof rec.total_completion_tokens === "number" && Number.isFinite(rec.total_completion_tokens)
        ? rec.total_completion_tokens
        : 0,
    estimated: rec.estimated === true,
    participants,
  };
}
