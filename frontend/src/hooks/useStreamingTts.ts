import { useCallback, useEffect, useRef } from "react";
import {
  defaultInlineCatalog,
  parseInlineTags,
  type InlineSequenceStep,
  type TimedInlineCue,
} from "@nexus/character-kit";
import { StreamingPcmPlayer, resumeAudioContext } from "@nexus/voice-kit/pcm-player";
import { FishTts } from "@nexus/voice-kit/tts-fish";
import { fetchFishTtsAlignedPcmStream, fetchFishTtsPcmStream } from "../lib/fishTts";
import { cueTimeForIndex, type WordTimelineEntry } from "../lib/ttsCueTiming";
import { hasSpeakableContent, sanitizeTtsText } from "../lib/ttsSanitize";
import { shouldIgnoreExistingTtsText, spokenCursorAtEnd } from "../lib/ttsHistorySkip";
import { dropSlugJobs, dropStaleSlugJobs } from "../lib/ttsSpeakQueue";
import { pullSpeakableUtterances } from "../lib/ttsUtterances";
import { longestCommonPrefixLength, type TtsSpeakMode } from "../lib/ttsSpeakMode";

const INLINE_CATALOG = defaultInlineCatalog();

export type TtsSpeakSource = {
  slug: string;
  enabled: boolean;
  text?: string;
  performanceText?: string;
  messageId?: string;
  streaming?: boolean;
  voiceId: string;
  /** "tool" skips auto-enqueue of message text; speak only via speakNow(). */
  speakMode?: TtsSpeakMode;
};

export type TtsQueueState = {
  speaking: boolean;
  speakingSlug: string | null;
  queueLength: number;
};

export type SpeakNowOpts = {
  slug?: string;
  messageId?: string;
  voiceId?: string;
  performanceText?: string;
};

export type StreamingTtsControls = {
  cancel: () => void;
  cancelCurrent: () => void;
  replayFromStart: () => void;
  speakNow: (text: string, opts?: SpeakNowOpts) => void;
  remapMessageId: (oldId: string, newId: string) => void;
};

export type StreamingTtsArgs = {
  enabled: boolean;
  /** Group-safe: one source per speaker. Falls back to `text` as slug "bot". */
  sources?: TtsSpeakSource[];
  text?: string;
  /** Raw assistant message (tags included) for timed face cues. */
  performanceText?: string;
  messageId?: string;
  streaming?: boolean;
  sessionId?: string;
  voiceId: string;
  fishApiKey?: string;
  audioContextRef: React.MutableRefObject<AudioContext | null>;
  onStatus: (status: string) => void;
  onError: (error: string) => void;
  onSpeakingChange: (speaking: boolean) => void;
  onLevel: (level: number) => void;
  listening: boolean;
  /** Fire character steps timed to speech. */
  onPlaySteps?: (steps: InlineSequenceStep[]) => void;
  /** Live VRM expression names for [grin]-style cues. */
  expressionNames?: string[];
  /** PCM playback graph for VRM visemes. `null` when that utterance ends. */
  onPlaybackStream?: (stream: MediaStream | null, audioContext: AudioContext) => void;
  onQueueState?: (state: TtsQueueState) => void;
};

type QueueCue = {
  localIndex: number;
  placement: TimedInlineCue["placement"];
  steps: InlineSequenceStep[];
  locomotion: boolean;
};

type QueueItem = {
  slug: string;
  messageId: string;
  text: string;
  voiceId: string;
  cues: QueueCue[];
};

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  if (name === "AbortError") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /aborted|AbortError/i.test(message);
}

async function ensureContext(
  ref: React.MutableRefObject<AudioContext | null>,
): Promise<AudioContext | null> {
  if (!ref.current) ref.current = new AudioContext();
  const running = await resumeAudioContext(ref.current);
  return running ? ref.current : null;
}

function faceCuesForSlice(
  performanceText: string | undefined,
  cleanSliceStart: number,
  cleanSliceLen: number,
  expressionNames?: string[],
): QueueCue[] {
  if (!performanceText?.trim()) return [];
  try {
    const catalog = {
      ...INLINE_CATALOG,
      expressions: [
        ...INLINE_CATALOG.expressions,
        // Fallback shapes when host catalog is not ready yet.
        "grin",
        "smile",
        "wink",
        "blush",
        ...(expressionNames || []).filter(Boolean),
      ],
    };
    const parsed = parseInlineTags(performanceText, catalog);
    const sanitizedFull = sanitizeTtsText(parsed.ttsText);
    const cues: QueueCue[] = [];
    for (const cue of parsed.timedCues) {
      if (cue.locomotion) continue;
      if (!cue.steps.length) continue;
      const inClean = sanitizedFull.mapOffset(cue.ttsIndex);
      if (inClean < cleanSliceStart || inClean > cleanSliceStart + cleanSliceLen) continue;
      cues.push({
        localIndex: inClean - cleanSliceStart,
        placement: cue.placement,
        steps: cue.steps,
        locomotion: cue.locomotion,
      });
    }
    return cues;
  } catch (err) {
    console.warn("[tts] failed to parse timed cues", err);
    return [];
  }
}

export function useStreamingTts({
  enabled,
  sources,
  text,
  performanceText,
  messageId,
  streaming,
  sessionId,
  voiceId,
  fishApiKey,
  audioContextRef,
  onStatus,
  onError,
  onSpeakingChange,
  onLevel,
  listening,
  onPlaySteps,
  expressionNames,
  onPlaybackStream,
  onQueueState,
}: StreamingTtsArgs): StreamingTtsControls {
  const queueRef = useRef<QueueItem[]>([]);
  const pumpingRef = useRef(false);
  const playerRef = useRef<StreamingPcmPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const skipCurrentRef = useRef(false);
  const playingRef = useRef<QueueItem | null>(null);
  const sourceCursorsRef = useRef(
    new Map<string, { messageId: string; spokenOffset: number; lastText: string }>(),
  );
  const prevEnabledRef = useRef(false);
  const prevSlugEnabledRef = useRef<Record<string, boolean>>({});
  const processedSessionRef = useRef(sessionId);
  const cueTimersRef = useRef<number[]>([]);
  const sessionIdRef = useRef(sessionId);
  const argsRef = useRef({
    enabled,
    fishApiKey,
    listening,
    onStatus,
    onError,
    onSpeakingChange,
    onLevel,
    onPlaySteps,
    onPlaybackStream,
    performanceText,
    expressionNames,
    onQueueState,
    sources,
    voiceId,
  });
  argsRef.current = {
    enabled,
    fishApiKey,
    listening,
    onStatus,
    onError,
    onSpeakingChange,
    onLevel,
    onPlaySteps,
    onPlaybackStream,
    performanceText,
    expressionNames,
    onQueueState,
    sources,
    voiceId,
  };

  const idleStatus = () =>
    argsRef.current.listening ? "listening" : argsRef.current.enabled ? "tts on" : "mic off";

  const clearCueTimers = () => {
    for (const id of cueTimersRef.current) window.clearTimeout(id);
    cueTimersRef.current = [];
  };

  const emitQueueState = (speaking: boolean) => {
    argsRef.current.onQueueState?.({
      speaking,
      speakingSlug: speaking ? playingRef.current?.slug ?? null : null,
      queueLength: queueRef.current.length,
    });
  };

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    skipCurrentRef.current = false;
    queueRef.current = [];
    pumpingRef.current = false;
    playingRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    clearCueTimers();
    playerRef.current?.stop();
    playerRef.current = null;
    const ctx = audioContextRef.current;
    if (ctx) argsRef.current.onPlaybackStream?.(null, ctx);
    argsRef.current.onSpeakingChange(false);
    argsRef.current.onLevel(0);
    emitQueueState(false);
  }, [audioContextRef]);

  const cancelCurrent = useCallback(() => {
    if (!playingRef.current && !queueRef.current.length) return;
    skipCurrentRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    clearCueTimers();
    playerRef.current?.stop();
    playerRef.current = null;
    const ctx = audioContextRef.current;
    if (ctx) argsRef.current.onPlaybackStream?.(null, ctx);
    playingRef.current = null;
    argsRef.current.onSpeakingChange(false);
    argsRef.current.onLevel(0);
    emitQueueState(queueRef.current.length > 0);
  }, [audioContextRef]);

  const scheduleCues = (
    item: QueueItem,
    player: StreamingPcmPlayer,
    timeline: WordTimelineEntry[],
  ) => {
    clearCueTimers();
    const play = argsRef.current.onPlaySteps;
    if (!play || !item.cues.length) return;

    const fire = (steps: InlineSequenceStep[]) => {
      if (cancelledRef.current) return;
      try {
        play(steps);
      } catch (err) {
        console.warn("[tts] timed cue failed", err);
      }
    };

    for (const cue of item.cues) {
      if (cue.placement === "start") {
        // Handled on player onStart
        continue;
      }
      if (cue.placement === "end") {
        // Handled when playback ends
        continue;
      }
      const delaySec = cueTimeForIndex({
        ttsIndex: cue.localIndex,
        utterance: item.text,
        timeline,
        scheduledDurationSec: Math.max(player.scheduledDuration, 0.01),
      });
      const startAt = player.audioStartTime;
      const now = audioContextRef.current?.currentTime ?? startAt;
      const waitMs = Math.max(0, (startAt + delaySec - now) * 1000);
      const id = window.setTimeout(() => fire(cue.steps), waitMs);
      cueTimersRef.current.push(id);
    }
  };

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    cancelledRef.current = false;
    const cb = () => argsRef.current;

    try {
      while (queueRef.current.length && !cancelledRef.current && argsRef.current.enabled) {
        const item = queueRef.current.shift();
        if (!item) break;
        skipCurrentRef.current = false;
        playingRef.current = item;
        emitQueueState(true);

        const ctx = await ensureContext(audioContextRef);
        if (!ctx) {
          console.warn("[tts] autoplay blocked — cancelling playback");
          cancel();
          cb().onError("");
          cb().onStatus("tts blocked");
          return;
        }

        cb().onError("");
        cb().onStatus("synthesizing…");
        const abort = new AbortController();
        abortRef.current = abort;

        const startCues = item.cues.filter((c) => c.placement === "start");
        const endCues = item.cues.filter((c) => c.placement === "end");
        let timeline: WordTimelineEntry[] = [];
        let midScheduled = false;

        const player = new StreamingPcmPlayer(ctx, {
          sampleRate: 24_000,
          onStart: () => {
            if (cancelledRef.current || skipCurrentRef.current) return;
            cb().onSpeakingChange(true);
            cb().onStatus("speaking");
            emitQueueState(true);
            for (const cue of startCues) cb().onPlaySteps?.(cue.steps);
            // Prefer Fish alignment; ratio fallback if none arrives before audio ends.
            if (timeline.length) {
              midScheduled = true;
              scheduleCues(item, player, timeline);
            }
          },
          onLevel: (level: number) => {
            if (!cancelledRef.current) cb().onLevel(level);
          },
          onBlocked: () => {
            console.warn("[tts] audio context blocked — cancelling playback");
            cancel();
            cb().onStatus("tts blocked");
          },
          onSilent: () => {
            console.warn("[tts] playback silent — cancelling");
            cancel();
            cb().onStatus(idleStatus());
          },
        });
        playerRef.current = player;

        try {
          const running = await player.ensureRunning();
          if (!running || cancelledRef.current) {
            if (skipCurrentRef.current && !cancelledRef.current) continue;
            break;
          }

          cb().onPlaybackStream?.(player.stream, ctx);

          const key = argsRef.current.fishApiKey?.trim();
          if (key) {
            // Direct Fish key: raw PCM (no proxy timestamps); ratio fallback for cues.
            const tts = new FishTts({ apiKey: key, referenceId: item.voiceId });
            const res = await tts.speakPcmStream(item.text, {
              voice: item.voiceId,
              signal: abort.signal,
            });
            if (!res.body) throw new Error("Fish TTS returned an empty body");
            const reader = res.body.getReader();
            try {
              while (!cancelledRef.current && !skipCurrentRef.current) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value?.byteLength) {
                  player.feed(value);
                  if (player.audioStartTime && !midScheduled) {
                    midScheduled = true;
                    scheduleCues(item, player, timeline);
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
          } else {
            let aligned;
            try {
              aligned = await fetchFishTtsAlignedPcmStream(item.text, item.voiceId, abort.signal);
            } catch (err) {
              if (cancelledRef.current || abort.signal.aborted || isAbortError(err)) {
                if (skipCurrentRef.current && !cancelledRef.current) continue;
                break;
              }
              // Fall back to raw PCM
              console.warn("[tts] aligned stream failed, using raw PCM", err);
              const raw = await fetchFishTtsPcmStream(item.text, item.voiceId, abort.signal);
              await player.consume(raw.reader);
              if (!midScheduled && player.audioStartTime) {
                midScheduled = true;
                scheduleCues(item, player, timeline);
              }
              for (const cue of endCues) {
                if (!cancelledRef.current) cb().onPlaySteps?.(cue.steps);
              }
              continue;
            }

            await aligned.consume(
              (bytes) => {
                player.feed(bytes);
              },
              (nextTimeline) => {
                timeline = nextTimeline;
                if (player.audioStartTime && timeline.length) {
                  midScheduled = true;
                  scheduleCues(item, player, timeline);
                }
              },
            );
            if (!midScheduled && player.audioStartTime) {
              midScheduled = true;
              scheduleCues(item, player, timeline);
            }
          }

          player.markEnd();
          await player.ended;
          for (const cue of endCues) {
            if (!cancelledRef.current) cb().onPlaySteps?.(cue.steps);
          }
        } finally {
          clearCueTimers();
          cb().onPlaybackStream?.(null, ctx);
          if (playerRef.current === player) playerRef.current = null;
          if (playingRef.current === item) playingRef.current = null;
        }
      }
    } catch (err) {
      if (cancelledRef.current || isAbortError(err)) {
        /* cancelled */
      } else {
        console.error("TTS failed", err);
        cb().onStatus("tts error");
        cb().onError(err instanceof Error ? err.message : "TTS failed");
      }
    } finally {
      pumpingRef.current = false;
      abortRef.current = null;
      if (!cancelledRef.current) {
        cb().onSpeakingChange(false);
        cb().onLevel(0);
        if (queueRef.current.length && argsRef.current.enabled) {
          void pump();
          return;
        }
        emitQueueState(false);
        cb().onStatus(idleStatus());
      }
    }
  }, [audioContextRef, cancel]);

  const enqueue = useCallback(
    (job: Omit<QueueItem, "text"> & { text: string }) => {
      const cleaned = sanitizeTtsText(job.text).text.trim();
      if (!cleaned) return;
      if (!hasSpeakableContent(cleaned)) {
        console.info("[tts] skip non-speakable utterance", {
          slug: job.slug,
          chars: cleaned.length,
          preview: cleaned.slice(0, 80),
        });
        return;
      }
      console.info("[tts] enqueue utterance", {
        slug: job.slug,
        chars: cleaned.length,
        cues: job.cues.length,
        queued: queueRef.current.length + 1,
      });
      queueRef.current.push({ ...job, text: cleaned });
      emitQueueState(Boolean(playingRef.current));
      void pump();
    },
    [pump],
  );

  const replayFromStart = useCallback(() => {
    sourceCursorsRef.current.clear();
  }, []);

  const speakNow = useCallback(
    (rawText: string, opts?: SpeakNowOpts) => {
      if (!argsRef.current.enabled) {
        console.info("[tts] speakNow ignored — TTS dock disabled or Fish not ready", {
          chars: rawText?.length || 0,
          slug: opts?.slug,
        });
        return;
      }
      const slug = (opts?.slug || "bot").trim() || "bot";
      const messageId = opts?.messageId || `speak-${Date.now()}`;
      const sourceList = argsRef.current.sources;
      const voice =
        opts?.voiceId ||
        sourceList?.find((s) => s.slug === slug)?.voiceId ||
        argsRef.current.voiceId ||
        voiceId;
      const performance = opts?.performanceText || rawText;
      let ttsRaw = rawText;
      try {
        ttsRaw = parseInlineTags(rawText, INLINE_CATALOG).ttsText;
      } catch {
        /* keep raw */
      }
      const cleaned = sanitizeTtsText(ttsRaw).text.trim();
      if (!cleaned || !hasSpeakableContent(cleaned)) return;
      const cues = faceCuesForSlice(performance, 0, cleaned.length, argsRef.current.expressionNames);
      enqueue({
        slug,
        messageId,
        text: cleaned,
        voiceId: voice,
        cues,
      });
    },
    [enqueue, voiceId],
  );

  const remapMessageId = useCallback((oldId: string, newId: string) => {
    if (!oldId || !newId || oldId === newId) return;
    for (const cursor of sourceCursorsRef.current.values()) {
      if (cursor.messageId === oldId) cursor.messageId = newId;
    }
    for (const job of queueRef.current) {
      if (job.messageId === oldId) job.messageId = newId;
    }
    if (playingRef.current?.messageId === oldId) {
      playingRef.current.messageId = newId;
    }
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  useEffect(() => {
    if (sessionIdRef.current !== sessionId) {
      sessionIdRef.current = sessionId;
      sourceCursorsRef.current.clear();
      prevSlugEnabledRef.current = {};
      cancel();
    }
  }, [cancel, sessionId]);

  const resolvedSources: TtsSpeakSource[] = sources
    ? sources
    : [
        {
          slug: "bot",
          enabled: true,
          text,
          performanceText,
          messageId,
          streaming,
          voiceId,
        },
      ];
  const sourcesKey = resolvedSources
    .map(
      (s) =>
        `${s.slug}|${s.enabled ? 1 : 0}|${s.speakMode || "auto"}|${s.messageId || ""}|${s.streaming ? 1 : 0}|${s.voiceId}|${(s.text || "").length}`,
    )
    .join(";");

  useEffect(() => {
    if (!enabled) {
      prevEnabledRef.current = false;
      cancel();
      return;
    }

    const justEnabled = !prevEnabledRef.current;
    prevEnabledRef.current = true;
    const sessionChanged = processedSessionRef.current !== sessionId;
    processedSessionRef.current = sessionId;
    if (sessionChanged) {
      sourceCursorsRef.current.clear();
      prevSlugEnabledRef.current = {};
    }

    for (const source of resolvedSources) {
      const slug = source.slug.trim() || "bot";
      if (!source.enabled) {
        prevSlugEnabledRef.current[slug] = false;
        queueRef.current = dropSlugJobs(queueRef.current, slug);
        if (playingRef.current?.slug === slug) {
          skipCurrentRef.current = true;
          abortRef.current?.abort();
        }
        sourceCursorsRef.current.delete(slug);
        continue;
      }

      // Tool mode: never auto-speak the printed assistant message.
      if ((source.speakMode || "auto") === "tool") {
        prevSlugEnabledRef.current[slug] = true;
        continue;
      }

      const nextText = source.text ?? "";
      const nextId = source.messageId || "";
      if (!nextId && !nextText.trim()) continue;

      const slugWasDisabled = prevSlugEnabledRef.current[slug] === false;
      prevSlugEnabledRef.current[slug] = true;
      if (shouldIgnoreExistingTtsText({ justEnabled, sessionChanged, slugWasDisabled })) {
        sourceCursorsRef.current.set(slug, spokenCursorAtEnd(nextId, nextText));
        console.debug("[tts] skip existing text", { slug, messageId: nextId, reason: justEnabled ? "enabled" : sessionChanged ? "session" : "slug" });
        continue;
      }

      let cursor = sourceCursorsRef.current.get(slug);
      if (!cursor || cursor.messageId !== nextId) {
        queueRef.current = dropStaleSlugJobs(queueRef.current, slug, nextId);
        if (playingRef.current?.slug === slug && playingRef.current.messageId !== nextId) {
          skipCurrentRef.current = true;
          abortRef.current?.abort();
        }
        cursor = { messageId: nextId, spokenOffset: 0, lastText: "" };
        sourceCursorsRef.current.set(slug, cursor);
      }

      if (!nextText.trim()) {
        cursor.lastText = nextText;
        continue;
      }
      if (cursor.spokenOffset > nextText.length) {
        // Sanitization/tag-close may shorten text; recover via LCP instead of hard reset.
        const lcp = longestCommonPrefixLength(cursor.lastText, nextText);
        cursor.spokenOffset = Math.min(cursor.spokenOffset, lcp);
      }
      const unread = nextText.slice(cursor.spokenOffset);
      const { utterances, rest } = pullSpeakableUtterances(unread, { flush: !source.streaming });
      const sliceStart = cursor.spokenOffset;
      cursor.spokenOffset = nextText.length - rest.length;
      cursor.lastText = nextText;

      let scan = sliceStart;
      for (const utterance of utterances) {
        const idx = nextText.indexOf(utterance, scan);
        const start = idx >= 0 ? idx : scan;
        const cues = faceCuesForSlice(
          source.performanceText || argsRef.current.performanceText,
          start,
          utterance.length,
          argsRef.current.expressionNames,
        );
        enqueue({
          slug,
          messageId: nextId,
          text: utterance,
          voiceId: source.voiceId,
          cues,
        });
        scan = start + utterance.length;
      }
    }
    emitQueueState(Boolean(playingRef.current));
    // resolvedSources is hashed via sourcesKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancel, enabled, enqueue, sessionId, sourcesKey]);

  return { cancel, cancelCurrent, replayFromStart, speakNow, remapMessageId };
}
