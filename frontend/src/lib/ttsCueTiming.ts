/**
 * Fish /v1/tts/stream/with-timestamp SSE helpers + cue timing.
 */

export type FishAlignmentSegment = {
  text: string;
  start: number;
  end: number;
};

export type FishTimestampEvent = {
  audio: Uint8Array;
  content?: string;
  chunkSeq?: number;
  chunkAudioOffsetSec?: number;
  alignment: {
    audio_duration: number;
    segments: FishAlignmentSegment[];
  } | null;
};

export type WordTimelineEntry = {
  text: string;
  start: number;
  end: number;
  chunkSeq: number;
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseFishTimestampEvent(raw: unknown): FishTimestampEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const audioB64 = typeof rec.audio_base64 === "string" ? rec.audio_base64 : "";
  if (!audioB64) return null;
  let alignment: FishTimestampEvent["alignment"] = null;
  const a = rec.alignment;
  if (a && typeof a === "object") {
    const ar = a as Record<string, unknown>;
    const segmentsRaw = Array.isArray(ar.segments) ? ar.segments : [];
    const segments: FishAlignmentSegment[] = [];
    for (const seg of segmentsRaw) {
      if (!seg || typeof seg !== "object") continue;
      const s = seg as Record<string, unknown>;
      if (typeof s.text !== "string") continue;
      const start = Number(s.start);
      const end = Number(s.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      segments.push({ text: s.text, start, end });
    }
    alignment = {
      audio_duration: Number(ar.audio_duration) || 0,
      segments,
    };
  }
  return {
    audio: base64ToBytes(audioB64),
    content: typeof rec.content === "string" ? rec.content : undefined,
    chunkSeq: typeof rec.chunk_seq === "number" ? rec.chunk_seq : undefined,
    chunkAudioOffsetSec:
      typeof rec.chunk_audio_offset_sec === "number" ? rec.chunk_audio_offset_sec : undefined,
    alignment,
  };
}

/**
 * Parse an SSE byte stream from Fish timestamp TTS.
 * Yields decoded audio + optional alignment snapshots.
 */
export async function* iterateFishTimestampSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<FishTimestampEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length) continue;
        try {
          const parsed = parseFishTimestampEvent(JSON.parse(dataLines.join("\n")));
          if (parsed) yield parsed;
        } catch {
          /* skip bad events */
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

/** Latest-wins alignment map → flat word timeline in absolute audio seconds. */
export function buildWordTimeline(
  byChunk: Map<
    number,
    {
      offset: number;
      alignment: NonNullable<FishTimestampEvent["alignment"]>;
    }
  >,
): WordTimelineEntry[] {
  const out: WordTimelineEntry[] = [];
  const keys = [...byChunk.keys()].sort((a, b) => a - b);
  for (const chunkSeq of keys) {
    const item = byChunk.get(chunkSeq)!;
    for (const segment of item.alignment.segments) {
      out.push({
        text: segment.text,
        start: segment.start + item.offset,
        end: segment.end + item.offset,
        chunkSeq,
      });
    }
  }
  return out;
}

/**
 * Map a character index in the spoken utterance to an audio time (seconds).
 * Uses Fish word segments when available; otherwise duration ratio.
 */
export function cueTimeForIndex(opts: {
  ttsIndex: number;
  utterance: string;
  timeline: WordTimelineEntry[];
  scheduledDurationSec: number;
}): number {
  const { ttsIndex, utterance, timeline, scheduledDurationSec } = opts;
  const clamped = Math.max(0, Math.min(utterance.length, ttsIndex));

  if (timeline.length) {
    // Walk cumulative spoken text (ignore Fish bracket tags for matching).
    const plain = utterance.replace(/\[[^\[\]]+\]/g, "");
    // Prefer mapping against plain text index approximated from ttsIndex.
    let plainIndex = 0;
    let inTag = false;
    for (let i = 0; i < clamped && i < utterance.length; i += 1) {
      const ch = utterance[i]!;
      if (ch === "[") inTag = true;
      else if (ch === "]") inTag = false;
      else if (!inTag) plainIndex += 1;
    }

    let cursor = 0;
    for (const seg of timeline) {
      const next = cursor + seg.text.length;
      // Allow whitespace gaps between segments
      if (plainIndex <= next || seg === timeline[timeline.length - 1]) {
        if (plainIndex <= cursor) return seg.start;
        const frac = seg.text.length ? (plainIndex - cursor) / seg.text.length : 0;
        return seg.start + Math.max(0, Math.min(1, frac)) * (seg.end - seg.start);
      }
      cursor = next;
      while (cursor < plain.length && /\s/.test(plain[cursor]!)) cursor += 1;
    }
    return timeline[timeline.length - 1]!.end;
  }

  const len = Math.max(1, utterance.length);
  return (clamped / len) * Math.max(0, scheduledDurationSec);
}
