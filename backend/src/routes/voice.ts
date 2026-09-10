import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { requireJwt } from "../middleware/auth.js";
import {
  configuredDefaultFishVoiceId,
  FISH_PCM_SAMPLE_RATE,
  isFishVoiceId,
  listFishVoices,
  resolveTtsVoiceId,
} from "../services/fishAudio.js";
import {
  FISH_TTS_STREAM_TIMEOUT_MS,
  attachClientAbort,
  isAbortError,
  openFishTtsUpstream,
  pipeWebStreamToExpress,
  ttsMime,
} from "../services/fishTtsProxy.js";
import { log } from "../utils/logger.js";
import { incMetric } from "../utils/metrics.js";

const router = Router();

const ttsBodySchema = z.object({
  text: z.string().min(1).max(8000),
  voice_id: z
    .string()
    .max(64)
    .optional()
    .nullable()
    .transform((v) => v?.trim() || undefined)
    .refine((v) => v === undefined || isFishVoiceId(v), "invalid Fish voice id"),
  format: z.enum(["mp3", "wav", "opus", "pcm"]).optional(),
  /** When true, proxy Fish SSE stream-with-timestamp (PCM + word alignment). */
  timestamps: z.boolean().optional(),
});

router.get("/status", requireJwt, (_req, res) => {
  const defaultVoiceId = configuredDefaultFishVoiceId(config.fishDefaultVoiceId);
  res.json({
    fish_configured: Boolean(config.fishApiKey.trim()),
    speaches_url: Boolean(config.speachesUrl),
    default_voice_id: defaultVoiceId,
  });
});

/** Workspace + library voices for per-avatar dropdowns. */
router.get("/voices", requireJwt, async (_req, res) => {
  const defaultVoiceId = configuredDefaultFishVoiceId(config.fishDefaultVoiceId);
  try {
    const { voices, cached, errors } = await listFishVoices({ apiKey: config.fishApiKey });
    if (errors.length) {
      log.warn({ errors }, "Fish voice catalog partial failure");
    }
    res.json({
      fish_configured: Boolean(config.fishApiKey.trim()),
      default_voice_id: defaultVoiceId,
      cached,
      voices,
    });
  } catch (e) {
    log.error({ err: e }, "Fish voice catalog error");
    res.status(502).json({
      error: e instanceof Error ? e.message : String(e),
      fish_configured: Boolean(config.fishApiKey.trim()),
      default_voice_id: defaultVoiceId,
      voices: [],
    });
  }
});

/** Proxy Fish TTS so the API key never reaches the browser. Streams PCM by default. */
router.post("/tts", requireJwt, async (req, res) => {
  const parsed = ttsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!config.fishApiKey.trim()) {
    res.status(503).json({ error: "FISH_API_KEY not configured on oc-controller" });
    return;
  }

  const withTimestamps = Boolean(parsed.data.timestamps);
  const format = withTimestamps ? "pcm" : parsed.data.format || "pcm";
  const voiceId = resolveTtsVoiceId(parsed.data.voice_id, configuredDefaultFishVoiceId(config.fishDefaultVoiceId));
  const usedDefault = !parsed.data.voice_id;
  const abort = new AbortController();
  const detachClientAbort = attachClientAbort(res, abort);

  try {
    let upstream = await openFishTtsUpstream({
      apiKey: config.fishApiKey,
      text: parsed.data.text.trim(),
      voiceId,
      format,
      withTimestamps,
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(FISH_TTS_STREAM_TIMEOUT_MS)]),
    });
    // Timestamp endpoint unavailable → fall back to raw PCM stream.
    if (withTimestamps && !upstream.ok) {
      const errBody = await upstream.text().catch(() => "");
      log.warn(
        { status: upstream.status, errBody: errBody.slice(0, 200), voiceId },
        "Fish TTS timestamp stream failed; falling back to raw PCM",
      );
      incMetric("oc_controller_fish_tts_timestamp_fallback_total", "Fish TTS timestamp fallbacks");
      upstream = await openFishTtsUpstream({
        apiKey: config.fishApiKey,
        text: parsed.data.text.trim(),
        voiceId,
        format: "pcm",
        withTimestamps: false,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(FISH_TTS_STREAM_TIMEOUT_MS)]),
      });
    }
    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => "");
      log.warn(
        { status: upstream.status, errBody: errBody.slice(0, 200), voiceId, usedDefault },
        "Fish TTS proxy failed",
      );
      incMetric("oc_controller_fish_tts_errors_total", "Fish TTS proxy failures");
      res.status(502).json({ error: `Fish TTS ${upstream.status}`, detail: errBody.slice(0, 400) });
      return;
    }
    if (!upstream.body) {
      incMetric("oc_controller_fish_tts_errors_total", "Fish TTS proxy failures");
      res.status(502).json({ error: "Fish TTS returned an empty body" });
      return;
    }

    const contentType =
      withTimestamps && upstream.headers.get("content-type")?.includes("text/event-stream")
        ? "text/event-stream"
        : ttsMime(format);
    const isSse = contentType.includes("text/event-stream");

    res.status(200);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Fish-Voice-Id", voiceId);
    if (format === "pcm" && !isSse) {
      res.setHeader("X-Fish-Sample-Rate", String(FISH_PCM_SAMPLE_RATE));
    }
    if (isSse) {
      res.setHeader("X-Fish-Sample-Rate", String(FISH_PCM_SAMPLE_RATE));
      res.setHeader("X-Fish-Timestamps", "1");
    }
    res.flushHeaders();

    const { bytes, firstByteMs } = await pipeWebStreamToExpress(upstream.body, res);
    incMetric("oc_controller_fish_tts_total", "Fish TTS proxy successes");
    if (firstByteMs !== null) {
      incMetric("oc_controller_fish_tts_first_byte_total", "Fish TTS streams that emitted audio");
    }
    log.info(
      {
        bytes,
        firstByteMs,
        voiceId,
        usedDefault,
        format,
        timestamps: isSse,
        textChars: parsed.data.text.trim().length,
        textPreview: parsed.data.text.trim().slice(0, 120),
      },
      "Fish TTS proxy ok",
    );
    res.end();
  } catch (e) {
    if (isAbortError(e) || abort.signal.aborted) {
      log.info({ voiceId, usedDefault, headersSent: res.headersSent }, "Fish TTS proxy aborted");
      if (!res.headersSent) {
        res.status(499).json({ error: "client aborted TTS" });
      }
      return;
    }
    incMetric("oc_controller_fish_tts_errors_total", "Fish TTS proxy failures");
    log.error({ err: e, voiceId, usedDefault }, "Fish TTS proxy error");
    if (!res.headersSent) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    } else {
      res.destroy();
    }
  } finally {
    detachClientAbort();
  }
});

export default router;
