import { once } from "node:events";
import type { Response as ExpressResponse } from "express";
import {
  buildTtsBody,
  FISH_API_BASE,
  FISH_PCM_SAMPLE_RATE,
  type TtsAudioFormat,
} from "./fishAudio.js";

export const FISH_TTS_STREAM_TIMEOUT_MS = 180_000;

export function ttsMime(format: TtsAudioFormat): string {
  if (format === "wav") return "audio/wav";
  if (format === "opus") return "audio/ogg";
  if (format === "pcm") return `audio/L16;rate=${FISH_PCM_SAMPLE_RATE};channels=1`;
  return "audio/mpeg";
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: unknown }).code;
  return name === "AbortError" || code === 20 || code === "ABORT_ERR";
}

/**
 * Abort upstream only if the client dropped the HTTP response.
 * Do not listen to `req.close` — Express emits that when the POST body is
 * finished, which would cancel Fish before audio starts.
 */
export function attachClientAbort(res: ExpressResponse, abort: AbortController): () => void {
  const onClose = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.on("close", onClose);
  return () => {
    res.off("close", onClose);
  };
}

export const FISH_TTS_TIMESTAMP_PATH = "/v1/tts/stream/with-timestamp";

export async function openFishTtsUpstream(opts: {
  apiKey: string;
  text: string;
  voiceId: string;
  format: TtsAudioFormat;
  signal?: AbortSignal;
  /** Use Fish SSE stream-with-timestamp endpoint (word alignment). */
  withTimestamps?: boolean;
}): Promise<globalThis.Response> {
  const path = opts.withTimestamps ? FISH_TTS_TIMESTAMP_PATH : "/v1/tts";
  return fetch(`${FISH_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      model: "s2.1-pro",
    },
    body: JSON.stringify(
      buildTtsBody({
        text: opts.text,
        voiceId: opts.voiceId,
        format: opts.format,
      }),
    ),
    signal: opts.signal,
  });
}

export async function pipeWebStreamToExpress(
  body: ReadableStream<Uint8Array>,
  res: ExpressResponse,
): Promise<{ bytes: number; firstByteMs: number | null }> {
  const reader = body.getReader();
  const started = Date.now();
  let bytes = 0;
  let firstByteMs: number | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (firstByteMs === null) firstByteMs = Date.now() - started;
      bytes += value.byteLength;
      const ok = res.write(Buffer.from(value));
      if (!ok) await once(res, "drain");
    }
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { bytes, firstByteMs };
}
