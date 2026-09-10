import { ensureFreshAccessToken, getAccessToken } from "../api/client";
import { resolveFishVoiceId } from "./fishVoices";
import {
  buildWordTimeline,
  iterateFishTimestampSse,
  type WordTimelineEntry,
} from "./ttsCueTiming";

const FISH_PCM_SAMPLE_RATE = 24_000;

function ttsHeaders(): Record<string, string> {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function postVoiceTts(
  text: string,
  voiceId: string | null | undefined,
  opts: { format: "mp3" | "pcm"; timestamps?: boolean; signal?: AbortSignal },
): Promise<Response> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("TTS text is empty");
  await ensureFreshAccessToken();
  const res = await fetch("/api/v1/voice/tts", {
    method: "POST",
    headers: ttsHeaders(),
    body: JSON.stringify({
      text: trimmed,
      voice_id: resolveFishVoiceId(voiceId),
      format: opts.format,
      ...(opts.timestamps ? { timestamps: true } : {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`TTS proxy ${res.status}: ${detail.slice(0, 240)}`);
  }
  return res;
}

/** Buffered MP3 — kept for decodeAudioData callers. */
export async function fetchFishTtsAudio(text: string, voiceId?: string | null): Promise<ArrayBuffer> {
  const res = await postVoiceTts(text, voiceId, { format: "mp3" });
  return res.arrayBuffer();
}

export type FishPcmStream = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  sampleRate: number;
  timestamps?: boolean;
};

/** Streaming 16-bit PCM. Play chunks as they arrive; do not wait for the full clip. */
export async function fetchFishTtsPcmStream(
  text: string,
  voiceId?: string | null,
  signal?: AbortSignal,
): Promise<FishPcmStream> {
  const res = await postVoiceTts(text, voiceId, { format: "pcm", signal });
  if (!res.body) throw new Error("TTS proxy returned an empty body");
  const parsed = Number(res.headers.get("X-Fish-Sample-Rate"));
  return {
    reader: res.body.getReader(),
    sampleRate: Number.isFinite(parsed) && parsed > 0 ? parsed : FISH_PCM_SAMPLE_RATE,
  };
}

export type FishAlignedPcmStream = {
  sampleRate: number;
  timestamps: boolean;
  /** Feed PCM into the player; updates `timeline` as alignment arrives. */
  consume: (
    onPcm: (bytes: Uint8Array) => void,
    onTimeline?: (timeline: WordTimelineEntry[]) => void,
  ) => Promise<void>;
};

/**
 * Prefer Fish SSE with word timestamps; fall back to raw PCM if the proxy
 * does not return an event-stream.
 */
export async function fetchFishTtsAlignedPcmStream(
  text: string,
  voiceId?: string | null,
  signal?: AbortSignal,
): Promise<FishAlignedPcmStream> {
  const res = await postVoiceTts(text, voiceId, {
    format: "pcm",
    timestamps: true,
    signal,
  });
  if (!res.body) throw new Error("TTS proxy returned an empty body");
  const parsed = Number(res.headers.get("X-Fish-Sample-Rate"));
  const sampleRate = Number.isFinite(parsed) && parsed > 0 ? parsed : FISH_PCM_SAMPLE_RATE;
  const isSse =
    res.headers.get("X-Fish-Timestamps") === "1" ||
    (res.headers.get("Content-Type") || "").includes("text/event-stream");

  if (!isSse) {
    const reader = res.body.getReader();
    return {
      sampleRate,
      timestamps: false,
      consume: async (onPcm) => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value?.byteLength) onPcm(value);
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  const reader = res.body.getReader();
  return {
    sampleRate,
    timestamps: true,
    consume: async (onPcm, onTimeline) => {
      const byChunk = new Map<
        number,
        {
          offset: number;
          alignment: NonNullable<
            import("./ttsCueTiming").FishTimestampEvent["alignment"]
          >;
        }
      >();
      for await (const event of iterateFishTimestampSse(reader)) {
        if (event.audio.byteLength) onPcm(event.audio);
        if (event.alignment && event.chunkSeq !== undefined) {
          byChunk.set(event.chunkSeq, {
            offset: event.chunkAudioOffsetSec ?? 0,
            alignment: event.alignment,
          });
          onTimeline?.(buildWordTimeline(byChunk));
        }
      }
    },
  };
}
