/**
 * Compact expandable voice control for the 3D viewport (dev-vrm AudioDock style).
 * STT toggle, TTS toggle, hold-to-talk, You/Bot meters.
 */
import { useEffect, useRef, useState } from "react";
import { resumeAudioContext } from "@openclaw/voice-kit/pcm-player";
import { SpeachesStt } from "@openclaw/voice-kit/stt-speaches";
import type { SttProvider, VadSession } from "@openclaw/voice-kit/types";
import { resolveFishVoiceId } from "../../lib/fishVoices";
import {
  DEFAULT_TTS_SPEAK_MODE,
  type TtsSpeakMode,
} from "../../lib/ttsSpeakMode";
import { useFishVoices } from "../../hooks/useFishVoices";
import { useStreamingTts, type TtsQueueState, type TtsSpeakSource } from "../../hooks/useStreamingTts";
import { SoundWave } from "./SoundWave";
import { TtsSkipStopButtons, TtsToggleButton } from "./TtsSpeakerButtons";

type Props = {
  onTranscript?: (transcript: string) => void;
  ttsText?: string;
  ttsMessageId?: string;
  ttsStreaming?: boolean;
  /** Raw assistant message for timed [grin]/face cues. */
  performanceText?: string;
  sessionId?: string;
  fishApiKey?: string;
  voiceId?: string | null;
  onPlayTimedSteps?: (steps: import("@openclaw/character-kit").InlineSequenceStep[]) => void;
  onTtsEnabledChange?: (enabled: boolean) => void;
  /** Live VRM expression names so [grin] etc. become timed face cues. */
  expressionNames?: string[];
  /** PCM graph for the speaking avatar's visemes. */
  onPlaybackStream?: (stream: MediaStream | null, audioContext: AudioContext) => void;
  /** Warm AudioWorklet / lip-sync after the TTS toggle click (user gesture). */
  onTtsPrepare?: (audioContext: AudioContext) => void;
  sources?: TtsSpeakSource[];
  onQueueState?: (state: TtsQueueState) => void;
  onTtsControls?: (ctl: {
    cancelCurrent: () => void;
    cancelQueue: () => void;
    speakNow: (text: string, opts?: { slug?: string; messageId?: string; voiceId?: string }) => void;
    remapMessageId: (oldId: string, newId: string) => void;
  }) => void;
  /** Workspace-level speak behavior (auto vs tool). */
  workspaceSpeakMode?: TtsSpeakMode;
  onWorkspaceSpeakModeChange?: (mode: TtsSpeakMode) => void;
};

const EXPANDED_KEY = "oc-chat-voice-expanded";
const TTS_KEY = "oc-chat-voice-tts";
const STT_KEY = "oc-chat-voice-stt";

function readFlag(key: string, fallback = false): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function SceneVoiceDock({
  onTranscript,
  ttsText,
  ttsMessageId,
  ttsStreaming,
  performanceText,
  sessionId,
  fishApiKey,
  voiceId,
  onPlayTimedSteps,
  onTtsEnabledChange,
  expressionNames,
  onPlaybackStream,
  onTtsPrepare,
  sources,
  onQueueState,
  onTtsControls,
  workspaceSpeakMode = DEFAULT_TTS_SPEAK_MODE,
  onWorkspaceSpeakModeChange,
}: Props) {
  const { defaultVoiceId, fishConfigured } = useFishVoices();
  const [expanded, setExpanded] = useState(() => readFlag(EXPANDED_KEY, false));
  const [ttsEnabled, setTtsEnabled] = useState(() => readFlag(TTS_KEY, false));
  const [sttEnabled, setSttEnabled] = useState(() => readFlag(STT_KEY, false));

  const [status, setStatus] = useState("mic off");
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [userLevel, setUserLevel] = useState(0);
  const [botLevel, setBotLevel] = useState(0);
  const [queueState, setQueueState] = useState<TtsQueueState>({
    speaking: false,
    speakingSlug: null,
    queueLength: 0,
  });

  const vadRef = useRef<VadSession | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const primarySttRef = useRef<SttProvider | null>(null);
  const fallbackSttRef = useRef<SttProvider | null>(null);
  const mountedRef = useRef(true);
  const listeningRef = useRef(false);

  const resolvedVoiceId = resolveFishVoiceId(voiceId, defaultVoiceId);
  const ttsReady = fishConfigured !== false;
  const {
    cancel: cancelTts,
    cancelCurrent,
    replayFromStart,
    speakNow,
    remapMessageId,
  } = useStreamingTts({
    enabled: ttsEnabled && ttsReady,
    sources,
    text: ttsText,
    performanceText,
    messageId: ttsMessageId,
    streaming: ttsStreaming,
    sessionId,
    voiceId: resolvedVoiceId,
    fishApiKey,
    audioContextRef,
    onStatus: setStatus,
    onError: setError,
    onSpeakingChange: setSpeaking,
    onLevel: setBotLevel,
    listening,
    onPlaySteps: onPlayTimedSteps,
    expressionNames,
    onPlaybackStream,
    onQueueState: (state) => {
      setQueueState(state);
      onQueueState?.(state);
    },
  });

  useEffect(() => {
    onTtsControls?.({
      cancelCurrent,
      cancelQueue: cancelTts,
      speakNow,
      remapMessageId,
    });
  }, [cancelCurrent, cancelTts, onTtsControls, remapMessageId, speakNow]);

  useEffect(() => {
    writeFlag(TTS_KEY, ttsEnabled);
    onTtsEnabledChange?.(ttsEnabled);
  }, [onTtsEnabledChange, ttsEnabled]);

  useEffect(() => {
    writeFlag(STT_KEY, sttEnabled);
  }, [sttEnabled]);

  useEffect(() => {
    writeFlag(EXPANDED_KEY, expanded);
  }, [expanded]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      void cleanupAll();
      fallbackSttRef.current?.dispose?.();
      primarySttRef.current?.dispose?.();
      cancelTts();
      audioContextRef.current?.close().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sttEnabled) {
      void startContinuousListen();
    } else {
      void stopContinuousListen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sttEnabled]);

  async function cleanupAll() {
    try {
      vadRef.current?.pause();
      vadRef.current?.destroy();
    } catch {
      /* ignore */
    }
    vadRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    recorderChunksRef.current = [];
    stopStream(mediaStreamRef.current);
    mediaStreamRef.current = null;
    listeningRef.current = false;
    if (mountedRef.current) {
      setListening(false);
      setRecording(false);
      setUserLevel(0);
    }
  }

  function ensurePrimaryStt(): SttProvider {
    if (!primarySttRef.current) {
      primarySttRef.current = new SpeachesStt({ baseUrl: "/api/speaches" });
    }
    return primarySttRef.current;
  }

  async function ensureFallbackStt(): Promise<SttProvider> {
    if (!fallbackSttRef.current) {
      const { BrowserWhisperStt } = await import("@openclaw/voice-kit/stt-browser-whisper");
      fallbackSttRef.current = new BrowserWhisperStt({ model: "Xenova/whisper-base.en" });
    }
    return fallbackSttRef.current;
  }

  async function transcribeAudio(audio: Blob) {
    if (!mountedRef.current) return;
    setError("");
    setTranscribing(true);
    setStatus("transcribing…");
    try {
      let provider = ensurePrimaryStt();
      let result;
      try {
        result = await provider.transcribe(audio);
      } catch (primaryError) {
        console.warn("Speaches STT failed, falling back to browser Whisper", primaryError);
        provider = await ensureFallbackStt();
        await provider.prepare?.();
        result = await provider.transcribe(audio);
      }
      const transcript = result.text.trim();
      setStatus(transcript ? `stt:${result.provider}` : "no speech");
      if (transcript) onTranscript?.(transcript);
    } catch (err) {
      console.error("Voice transcription failed", err);
      setStatus("stt error");
      setError(err instanceof Error ? err.message : "STT failed");
    } finally {
      setTranscribing(false);
      setUserLevel(0);
      if (mountedRef.current && listeningRef.current) setStatus("listening");
      else if (mountedRef.current && !listeningRef.current) setStatus("mic off");
    }
  }

  async function startContinuousListen() {
    if (listeningRef.current || recording) return;
    setError("");
    setStatus("starting…");
    try {
      try {
        if (!vadRef.current) {
          const { createSileroVadSession } = await import("@openclaw/voice-kit/vad-silero");
          const vad = await createSileroVadSession({
            onSpeechStart: () => setStatus("speech"),
            onSpeechEnd: async (pcm) => {
              const wav = new Blob([float32ToWavBuffer(pcm)], { type: "audio/wav" });
              await transcribeAudio(wav);
              if (mountedRef.current && listeningRef.current) setStatus("listening");
            },
            onFrameProcessed: ({ rms }) => {
              setUserLevel(Math.min(1, rms * 12));
            },
            onStatus: (next) => {
              if (next === "listening" && listeningRef.current) setStatus("listening");
            },
          });
          vadRef.current = vad;
        }
        await vadRef.current.start();
        listeningRef.current = true;
        setListening(true);
        setStatus("listening");
      } catch (vadError) {
        console.warn("Silero VAD unavailable for continuous STT", vadError);
        setError("VAD unavailable — use hold-to-talk");
        setSttEnabled(false);
        setStatus("mic off");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mic failed");
      setSttEnabled(false);
      setStatus("mic off");
    }
  }

  async function stopContinuousListen() {
    try {
      vadRef.current?.pause();
    } catch {
      /* ignore */
    }
    listeningRef.current = false;
    setListening(false);
    setUserLevel(0);
    if (!recording) setStatus(ttsEnabled ? "tts on" : "mic off");
  }

  async function startHoldRecord() {
    if (recording || transcribing) return;
    setError("");
    // Pause continuous STT while holding PTT
    try {
      vadRef.current?.pause();
    } catch {
      /* ignore */
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recorderChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        mediaRecorderRef.current = null;
        recorderChunksRef.current = [];
        stopStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
        setRecording(false);
        if (blob.size > 0) void transcribeAudio(blob);
        else setStatus(listeningRef.current ? "listening" : "mic off");
        if (sttEnabled && listeningRef.current) {
          void vadRef.current?.start().then(() => {
            if (mountedRef.current) setStatus("listening");
          });
        }
      };
      recorder.start();
      setRecording(true);
      setStatus("recording…");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Record failed");
      setStatus("mic off");
    }
  }

  function stopHoldRecord() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setStatus("transcribing…");
    }
  }

  function toggleTts() {
    setTtsEnabled((on) => {
      const next = !on;
      if (!next) {
        cancelTts();
        setSpeaking(false);
        setBotLevel(0);
      } else {
        replayFromStart();
        // Prefer tool-speak when turning TTS on (avoids reading full replies).
        if (workspaceSpeakMode === "auto" && onWorkspaceSpeakModeChange) {
          onWorkspaceSpeakModeChange("tool");
        }
        void (async () => {
          try {
            if (!audioContextRef.current) audioContextRef.current = new AudioContext();
            const ctx = audioContextRef.current;
            const running = await resumeAudioContext(ctx);
            if (running) onTtsPrepare?.(ctx);
          } catch (err) {
            console.warn("[tts] lip-sync prepare failed", err);
          }
        })();
      }
      return next;
    });
  }

  function toggleStt() {
    setSttEnabled((on) => !on);
  }

  if (!expanded) {
    return (
      <div className="scene-voice-collapsed">
        <button
          type="button"
          className={`kb-icon scene-voice-expand ${listening || speaking || ttsEnabled || sttEnabled ? "on" : ""}`}
          title="Expand voice controls"
          aria-label="Expand voice controls"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="scene-voice-dock" role="group" aria-label="Voice controls">
      <div className={`scene-voice-lane you ${listening || recording ? "live" : ""} ${!sttEnabled ? "muted" : ""}`}>
        <span className="scene-voice-tag">You</span>
        <SoundWave energy={userLevel} active={listening || recording} />
      </div>
      <div className={`scene-voice-lane bot ${speaking ? "live" : ""} ${!ttsEnabled ? "muted" : ""}`}>
        <span className="scene-voice-tag">Bot</span>
        <SoundWave energy={botLevel} active={speaking} />
      </div>

      <button
        type="button"
        className={`scene-voice-btn ${sttEnabled ? "on" : "off"}`}
        title={sttEnabled ? "Disable STT (listening)" : "Enable STT"}
        aria-pressed={sttEnabled}
        onClick={toggleStt}
        disabled={transcribing || recording}
      >
        {sttEnabled ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19 11h-2a5 5 0 0 1-.54 2.28l1.46 1.46A6.97 6.97 0 0 0 19 11ZM10.8 5.1 12 4.9V6l2.9 2.9A3 3 0 0 0 12 6V5.1ZM4.27 3 3 4.27 8.73 10H8a4 4 0 0 0 4 4c.3 0 .58-.04.86-.1l1.4 1.4A6.93 6.93 0 0 1 12 17.92V21h2v-3.08c.8-.12 1.55-.4 2.24-.8l3.49 3.49L21 19.73 4.27 3Z"
            />
          </svg>
        )}
      </button>

      <TtsToggleButton
        enabled={ttsEnabled}
        ready={ttsReady}
        onClick={toggleTts}
      />
      {onWorkspaceSpeakModeChange ? (
        <label className="scene-voice-speak-mode" title="How bot replies are spoken">
          <span className="sr-only">Speak behavior</span>
          <select
            value={workspaceSpeakMode}
            onChange={(e) =>
              onWorkspaceSpeakModeChange(e.target.value === "auto" ? "auto" : "tool")
            }
            aria-label="Speak behavior"
          >
            <option value="tool">Tool speak</option>
            <option value="auto">Auto-speak</option>
          </select>
        </label>
      ) : null}
      {speaking || queueState.queueLength > 0 ? (
        <TtsSkipStopButtons
          disableSkip={!speaking && queueState.queueLength === 0}
          onSkip={cancelCurrent}
          onStop={cancelTts}
        />
      ) : null}

      <button
        type="button"
        className={`scene-voice-btn rec ${recording ? "hot" : ""}`}
        title="Hold to talk · release to send"
        aria-pressed={recording}
        disabled={transcribing}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* optional */
          }
          void startHoldRecord();
        }}
        onPointerUp={() => stopHoldRecord()}
        onPointerCancel={() => stopHoldRecord()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7" fill="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        className="scene-voice-btn"
        title="Collapse voice controls"
        aria-label="Collapse"
        onClick={() => setExpanded(false)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
        </svg>
      </button>

      <p className="scene-voice-status" title={error || status}>
        {error || status}
      </p>
    </div>
  );
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function float32ToWavBuffer(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
