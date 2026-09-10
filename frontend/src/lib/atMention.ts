/**
 * Detect an @mention query at the caret that is safe for emails:
 * only triggers when `@` follows start-of-string or whitespace/open-brackets,
 * never after a local-part character (`user@…`).
 */
export type AtMentionQuery = {
  /** Index of the `@` in the full text. */
  start: number;
  /** Text after `@` up to the caret. */
  query: string;
};

const MENTION_AT =
  /(^|[\s([{<"'])@([a-zA-Z0-9][a-zA-Z0-9._-]*)?$/;

export function getAtMentionQuery(text: string, caret: number): AtMentionQuery | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const match = before.match(MENTION_AT);
  if (!match) return null;
  const token = match[2] ?? "";
  const start = before.length - token.length - 1;
  if (text[start] !== "@") return null;
  return { start, query: token };
}

export function filterMentionSuggestions(
  slugs: string[],
  query: string,
  limit = 8,
  extras: string[] = ["all", "room"],
): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of extras) {
    const slug = raw.trim();
    if (!slug || seen.has(slug)) continue;
    if (q && !slug.toLowerCase().startsWith(q) && !slug.toLowerCase().includes(q)) continue;
    seen.add(slug);
    out.push(slug);
  }

  for (const raw of slugs) {
    const slug = raw.trim();
    if (!slug || seen.has(slug)) continue;
    if (q && !slug.toLowerCase().startsWith(q) && !slug.toLowerCase().includes(q)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= limit) break;
  }
  // Prefer prefix matches when filtering (keep broadcast aliases first).
  if (q) {
    const aliases = new Set(extras.map((e) => e.toLowerCase()));
    out.sort((a, b) => {
      const aAlias = aliases.has(a.toLowerCase()) ? 0 : 1;
      const bAlias = aliases.has(b.toLowerCase()) ? 0 : 1;
      if (aAlias !== bAlias) return aAlias - bAlias;
      const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.localeCompare(b);
    });
  }
  return out.slice(0, limit);
}

export function applyMentionInsertion(
  text: string,
  caret: number,
  mentionStart: number,
  slug: string,
): { text: string; caret: number } {
  const before = text.slice(0, mentionStart);
  const after = text.slice(caret);
  const insertion = `@${slug} `;
  return {
    text: `${before}${insertion}${after}`,
    caret: before.length + insertion.length,
  };
}
