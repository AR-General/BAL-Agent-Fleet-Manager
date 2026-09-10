/** Keep in sync with character-kit `FISH_TTS_TAGS` + free-form spaced phrases. */
const FISH_TTS_TAGS = new Set(
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
  ].map((t) => t.toLowerCase()),
);

export type SanitizeTtsResult = {
  text: string;
  /** Map an index in the pre-sanitize string to the nearest index in `text`. */
  mapOffset: (originalIndex: number) => number;
};

const ZW_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g;
const HEADING_RE = /^#{1,6}\s+/gm;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/gm;
const CODE_TICK_RE = /`([^`]+)`/g;
const STRIKE_RE = /~~([^~]+)~~/g;
const BOLD_STAR_RE = /\*\*([^*]+)\*\*/g;
const BOLD_UNDER_RE = /__([^_]+)__/g;
const ITALIC_STAR_RE = /(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g;
const ITALIC_UNDER_RE = /(^|[^_\w])_([^_\n]+)_(?=[^_\w]|$)/g;
const BRACKET_RE = /\[([^\[\]]+)\]/g;
const LOOSE_EMPHASIS_RE = /[*_~`#]+/g;
const MULTI_WS_RE = /[ \t]{2,}/g;
const MULTI_NL_RE = /\n{3,}/g;
const SPACE_BEFORE_PUNCT_RE = / +([.,!?;:])/g;

/** Stage direction like *waves* / *smiles* — drop entirely. */
const STAGE_ACTIONS = new Set(
  [
    "waves",
    "smiles",
    "smile",
    "nods",
    "laughs",
    "sighs",
    "grins",
    "grin",
    "winks",
    "wink",
    "shrugs",
    "bows",
    "claps",
    "cheers",
    "giggles",
    "chuckles",
    "gasps",
    "pauses",
    "thinks",
    "looks around",
    "clears throat",
    "grinning",
    "smiling",
    "laughing",
    "chuckling",
  ].map((s) => s.toLowerCase()),
);
const STAGE_DIR_RE = /(^|[^*])\*([A-Za-z][A-Za-z' -]{0,40})\*(?=[^*]|$)/g;
const PAREN_STAGE_RE = /\(([A-Za-z][A-Za-z' -]{0,40})\)/g;
const UNICODE_EMPHASIS_RE = /[＊∗⁎￪￫]+/g;

/** Emotion roots allowed inside short free-form Fish phrases. */
const FISH_FREEFORM_ROOT =
  /(happy|sad|angry|calm|warm|soft|gentle|nervous|excited|confident|surprised|worried|proud|curious|hopeful|scared|upset|tired|bright|quiet|loud|empathetic|embarrassed|grateful|sarcastic|determined|relaxed|delighted|satisfied|frustrated)/i;

/**
 * Fish S2 annotations that must stay in spoken text.
 * Free-form is narrowly limited — open-ended `[anything with spaces]` makes Fish
 * emit long non-lexical garbage (e.g. `[soft laugh]` / laugh spam phrases).
 */
export function isFishAnnotationInner(inner: string): boolean {
  const t = inner.trim().toLowerCase();
  if (!t) return false;
  if (FISH_TTS_TAGS.has(t)) return true;
  if (t.includes(",") || t.includes("|") || t.includes("=")) return false;
  // Reject onomatopoeia / breath spam that Fish turns into seconds of heh/hash noise.
  if (/(heh|hah|haha|hash|huh|eee|ahh|umm|lol|hehe|huhu|\blaugh)/i.test(t)) return false;
  // Short emotion phrases only: [warm and happy], [slightly sad]
  if (!/^[a-z]+(?:[\s-][a-z]+){1,3}$/.test(t)) return false;
  return FISH_FREEFORM_ROOT.test(t);
}

/** Letters/digits left after removing Fish/character square tags. */
export function speakablePlainText(text: string): string {
  return text
    .replace(/\[[^\[\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when Fish would have real words to speak (not tags/punctuation alone). */
export function hasSpeakableContent(text: string): boolean {
  return speakablePlainText(text).length > 0;
}

type Edit = { start: number; end: number; insert: string };

function applyEdits(source: string, edits: Edit[]): SanitizeTtsResult {
  if (!edits.length) {
    return {
      text: source,
      mapOffset: (i) => Math.max(0, Math.min(source.length, i)),
    };
  }

  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: string[] = [];
  /** For each output index, original source index that produced it. */
  const outToSrc: number[] = [];
  let cursor = 0;

  for (const edit of sorted) {
    if (edit.start < cursor) continue;
    for (let i = cursor; i < edit.start; i += 1) {
      out.push(source[i]!);
      outToSrc.push(i);
    }
    for (let i = 0; i < edit.insert.length; i += 1) {
      out.push(edit.insert[i]!);
      outToSrc.push(edit.start);
    }
    cursor = edit.end;
  }
  for (let i = cursor; i < source.length; i += 1) {
    out.push(source[i]!);
    outToSrc.push(i);
  }

  const text = out.join("");
  /** Forward map: original index → output index (first char that came from >= that src). */
  const srcToOut = new Array<number>(source.length + 1).fill(text.length);
  for (let oi = 0; oi < outToSrc.length; oi += 1) {
    const si = outToSrc[oi]!;
    if (srcToOut[si] === text.length || srcToOut[si]! > oi) srcToOut[si] = oi;
  }
  let last = text.length;
  for (let si = source.length; si >= 0; si -= 1) {
    if (srcToOut[si] === text.length) srcToOut[si] = last;
    else last = srcToOut[si]!;
  }

  return {
    text,
    mapOffset: (originalIndex: number) => {
      const clamped = Math.max(0, Math.min(source.length, originalIndex));
      return srcToOut[clamped] ?? text.length;
    },
  };
}

function collectRegexEdits(
  source: string,
  re: RegExp,
  replace: (match: RegExpExecArray) => { start: number; end: number; insert: string } | null,
): Edit[] {
  const edits: Edit[] = [];
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const rx = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = rx.exec(source))) {
    const edit = replace(m);
    if (edit) edits.push(edit);
  }
  return edits;
}

/**
 * Clean text after character-kit tag stripping so Fish does not speak
 * asterisks / leftover [grin] / zero-width junk. Preserves Fish S2 tags.
 */
export function sanitizeTtsText(input: string): SanitizeTtsResult {
  let working = input;
  let mapOffset = (i: number) => Math.max(0, Math.min(working.length, i));

  const chain = (next: SanitizeTtsResult) => {
    const prevMap = mapOffset;
    working = next.text;
    mapOffset = (originalIndex: number) => next.mapOffset(prevMap(originalIndex));
  };

  // Zero-width / control
  {
    const edits = collectRegexEdits(working, ZW_CONTROL_RE, (m) => ({
      start: m.index,
      end: m.index + m[0].length,
      insert: "",
    }));
    if (edits.length) chain(applyEdits(working, edits));
  }

  // Headings / hr / code / strike
  for (const [re, replacer] of [
    [
      HEADING_RE,
      (m: RegExpExecArray) => ({ start: m.index, end: m.index + m[0].length, insert: "" }),
    ],
    [HR_RE, (m: RegExpExecArray) => ({ start: m.index, end: m.index + m[0].length, insert: "" })],
    [
      CODE_TICK_RE,
      (m: RegExpExecArray) => ({
        start: m.index,
        end: m.index + m[0].length,
        insert: m[1] ?? "",
      }),
    ],
    [
      STRIKE_RE,
      (m: RegExpExecArray) => ({
        start: m.index,
        end: m.index + m[0].length,
        insert: m[1] ?? "",
      }),
    ],
  ] as const) {
    const edits = collectRegexEdits(working, re, replacer);
    if (edits.length) chain(applyEdits(working, edits));
  }

  // Bold then italic / stage directions
  for (const re of [BOLD_STAR_RE, BOLD_UNDER_RE]) {
    const edits = collectRegexEdits(working, re, (m) => ({
      start: m.index,
      end: m.index + m[0].length,
      insert: m[1] ?? "",
    }));
    if (edits.length) chain(applyEdits(working, edits));
  }

  {
    const edits = collectRegexEdits(working, STAGE_DIR_RE, (m) => {
      const inner = (m[2] ?? "").trim();
      const leadLen = m[1]?.length ?? 0;
      if (STAGE_ACTIONS.has(inner.toLowerCase())) {
        return {
          start: m.index + leadLen,
          end: m.index + m[0].length,
          insert: "",
        };
      }
      return {
        start: m.index + leadLen,
        end: m.index + m[0].length,
        insert: inner,
      };
    });
    if (edits.length) chain(applyEdits(working, edits));
  }

  for (const re of [ITALIC_STAR_RE, ITALIC_UNDER_RE]) {
    const edits = collectRegexEdits(working, re, (m) => ({
      start: m.index + (m[1]?.length ?? 0),
      end: m.index + m[0].length,
      insert: m[2] ?? "",
    }));
    if (edits.length) chain(applyEdits(working, edits));
  }

  // Strip non-Fish [brackets]
  {
    const edits = collectRegexEdits(working, BRACKET_RE, (m) => {
      const inner = m[1] ?? "";
      if (isFishAnnotationInner(inner)) return null;
      return { start: m.index, end: m.index + m[0].length, insert: "" };
    });
    if (edits.length) chain(applyEdits(working, edits));
  }

  // Parenthetical stage directions: (grinning), (laughs)
  {
    const edits = collectRegexEdits(working, PAREN_STAGE_RE, (m) => {
      const inner = (m[1] ?? "").trim();
      if (!STAGE_ACTIONS.has(inner.toLowerCase())) return null;
      return { start: m.index, end: m.index + m[0].length, insert: "" };
    });
    if (edits.length) chain(applyEdits(working, edits));
  }

  // Unicode emphasis stars that ASCII strippers miss
  {
    const edits = collectRegexEdits(working, UNICODE_EMPHASIS_RE, (m) => ({
      start: m.index,
      end: m.index + m[0].length,
      insert: "",
    }));
    if (edits.length) chain(applyEdits(working, edits));
  }

  // Leftover emphasis markers
  {
    const edits = collectRegexEdits(working, LOOSE_EMPHASIS_RE, (m) => ({
      start: m.index,
      end: m.index + m[0].length,
      insert: "",
    }));
    if (edits.length) chain(applyEdits(working, edits));
  }

  // Collapse whitespace
  {
    const edits = [
      ...collectRegexEdits(working, MULTI_WS_RE, (m) => ({
        start: m.index,
        end: m.index + m[0].length,
        insert: " ",
      })),
      ...collectRegexEdits(working, MULTI_NL_RE, (m) => ({
        start: m.index,
        end: m.index + m[0].length,
        insert: "\n\n",
      })),
      ...collectRegexEdits(working, SPACE_BEFORE_PUNCT_RE, (m) => ({
        start: m.index,
        end: m.index + m[0].length,
        insert: m[1] ?? "",
      })),
    ];
    if (edits.length) chain(applyEdits(working, edits));
  }

  const trimmed = working.trim();
  if (trimmed !== working) {
    const lead = working.length - working.trimStart().length;
    const trail = working.length - working.trimEnd().length;
    const start = lead;
    const end = working.length - trail;
    const slice = working.slice(start, end);
    const prevMap = mapOffset;
    working = slice;
    mapOffset = (originalIndex: number) => {
      const mid = prevMap(originalIndex);
      if (mid <= start) return 0;
      if (mid >= end) return slice.length;
      return mid - start;
    };
  }

  return { text: working, mapOffset };
}
