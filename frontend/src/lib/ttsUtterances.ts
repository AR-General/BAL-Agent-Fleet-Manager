/** Split accumulating LLM text into speakable TTS utterances. */

const DEFAULT_MIN_CHARS = 24;
const DEFAULT_MAX_CHARS = 220;

/**
 * Keep in sync with `ttsSanitize.isFishAnnotationInner` / character-kit `isFishAnnotation`.
 * Inlined so Node tests and Vite both resolve without extension games.
 */
function isAbsorbableFishTag(inner: string): boolean {
  const t = inner.trim().toLowerCase();
  if (!t) return false;
  const known = new Set(
    [
      "happy",
      "sad",
      "angry",
      "excited",
      "calm",
      "nervous",
      "confident",
      "surprised",
      "satisfied",
      "delighted",
      "scared",
      "worried",
      "upset",
      "frustrated",
      "empathetic",
      "embarrassed",
      "proud",
      "relaxed",
      "grateful",
      "curious",
      "sarcastic",
      "hopeful",
      "determined",
      "whispering",
      "soft tone",
      "shouting",
      "screaming",
      "in a hurry tone",
      "emphasis",
      "laughing",
      "chuckling",
      "sighing",
      "gasping",
      "clear throat",
      "break",
      "long-break",
      "thinking aloud",
    ].map((s) => s.toLowerCase()),
  );
  if (known.has(t)) return true;
  if (t.includes(",") || t.includes("|") || t.includes("=")) return false;
  if (/(heh|hah|haha|hash|huh|eee|ahh|umm|lol|hehe|huhu|\blaugh)/i.test(t)) return false;
  if (!/^[a-z]+(?:[\s-][a-z]+){1,3}$/.test(t)) return false;
  return /(happy|sad|angry|calm|warm|soft|gentle|nervous|excited|confident|surprised|worried|proud|curious|hopeful|scared|upset|tired|bright|quiet|loud|empathetic|embarrassed|grateful|sarcastic|determined|relaxed|delighted|satisfied|frustrated)/i.test(
    t,
  );
}

export type PullUtterancesOptions = {
  /** End of the assistant turn — emit whatever is left. */
  flush?: boolean;
  minChars?: number;
  maxChars?: number;
};

export function bracketDepth(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "[") depth += 1;
    else if (ch === "]" && depth > 0) depth -= 1;
  }
  return depth;
}

function isBoundary(text: string, index: number): boolean {
  const ch = text[index];
  if (ch === "\n") return true;
  if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…" && ch !== "。") return false;
  if (ch === "." && index > 0 && /\d/.test(text[index - 1] || "")) return false;
  const next = text[index + 1];
  return !next || /\s/.test(next) || next === '"' || next === "'" || next === ")" || next === "]";
}

function lastSafeSplit(text: string, maxChars: number, minChars: number): number {
  let depth = 0;
  let lastSpace = -1;
  const limit = Math.min(text.length, maxChars);
  for (let i = 0; i < limit; i += 1) {
    const ch = text[i]!;
    if (ch === "[") depth += 1;
    else if (ch === "]" && depth > 0) depth -= 1;
    else if (depth === 0 && /\s/.test(ch)) lastSpace = i;
  }
  if (lastSpace >= minChars) return lastSpace + 1;
  return depth === 0 ? limit : -1;
}

/**
 * After a sentence end, fold immediately-following Fish emotion tags into the
 * same utterance so we never POST a tag-only clip (Fish fills those with noise).
 */
export function absorbTrailingFishTags(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    if (text[i] !== "[") break;
    const close = text.indexOf("]", i);
    if (close < 0) break;
    const inner = text.slice(i + 1, close);
    if (!isAbsorbableFishTag(inner)) break;
    i = close + 1;
  }
  return i;
}

/**
 * Pull complete utterances from a pending TTS buffer.
 * Does not split inside `[square]` tags (Fish + character-kit cues).
 */
export function pullSpeakableUtterances(
  pending: string,
  opts: PullUtterancesOptions = {},
): { utterances: string[]; rest: string } {
  const flush = Boolean(opts.flush);
  const minChars = opts.minChars ?? DEFAULT_MIN_CHARS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const utterances: string[] = [];
  let rest = pending;

  while (rest.length) {
    let splitAt = -1;
    let depth = 0;
    for (let i = 0; i < rest.length; i += 1) {
      const ch = rest[i]!;
      if (ch === "[") depth += 1;
      else if (ch === "]" && depth > 0) depth -= 1;
      if (depth !== 0) continue;
      if (isBoundary(rest, i)) {
        splitAt = absorbTrailingFishTags(rest, i + 1);
        while (splitAt < rest.length && /\s/.test(rest[splitAt]!)) splitAt += 1;
        break;
      }
    }

    if (splitAt < 0 && rest.length >= maxChars) {
      splitAt = lastSafeSplit(rest, maxChars, minChars);
    }

    if (splitAt < 0) {
      if (flush) {
        const trimmed = rest.trim();
        if (trimmed) utterances.push(trimmed);
        rest = "";
      }
      break;
    }

    const chunk = rest.slice(0, splitAt).trim();
    rest = rest.slice(splitAt);
    if (chunk) utterances.push(chunk);
  }

  return { utterances, rest };
}
