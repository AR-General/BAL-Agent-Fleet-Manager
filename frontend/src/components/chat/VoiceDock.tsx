import { useEffect, useMemo, useRef, useState } from "react";
import { StreamingPcmPlayer, resumeAudioContext } from "@nexus/voice-kit/pcm-player";
import { SpeachesStt } from "@nexus/voice-kit/stt-speaches";
import { FishTts } from "@nexus/voice-kit/tts-fish";
import type { SttProvider, VadSession } from "@nexus/voice-kit/types";
import { fetchFishTtsPcmStream } from "../../lib/fishTts";
import { resolveFishVoiceId } from "../../lib/fishVoices";
import { useFishVoices } from "../../hooks/useFishVoices";

type Props = {
  onTranscript?: (transcript: string) => void;
  ttsText?: string;
  /** Optional direct Fish key; prefer oc-controller `/voice/tts` proxy when omitted. */
  fishApiKey?: string;
  voiceId?: string | null;
};

type InputMode = "hold" | "toggle";

export function VoiceDock({ onTranscript, ttsText, fishApiKey, voiceId }: Props) {
  const { defaultVoiceId, fishConfigured } = useFishVoices();
  const [inputMode, setInputMode] = useState<InputMode>("hold");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [active, setActive] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [lastTranscript, setLastTranscript] = useState("");
  const vadRef = useRef<VadSession | null>(null);
  const usingVadRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackStopRef = useRef<(() => void) | null>(null);
  const primarySttRef = useRef<SttProvider | null>(null);
  const fallbackSttRef = useRef<SttProvider | null>(null);
  const mountedRef = useRef(true);
  const activeRef = useRef(false);

  const resolvedVoiceId = resolveFishVoiceId(voiceId, defaultVoiceId);
  const ttsReady = fishConfigured !== false;
  const canSpeak = useMemo(
    () => Boolean(ttsText?.trim()) && ttsReady,
    [ttsText, ttsReady],
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      void cleanupVoiceResources();
      fallbackSttRef.current?.dispose?.();
      primarySttRef.current?.dispose?.();
      playbackStopRef.current?.();
      playbackStopRef.current = null;
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, []);

  async function cleanupVoiceResources() {
    try {
      vadRef.current?.pause();
      vadRef.current?.destroy();
    } catch (cleanupError) {
      console.warn("Failed to destroy VAD session", cleanupError);
    }
    vadRef.current = null;
    usingVadRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    recorderChunksRef.current = [];
    stopStream(mediaStreamRef.current);
    mediaStreamRef.current = null;
    if (mountedRef.current) {
      setActiveState(false);
      setLevel(0);
    }
  }

  function setActiveState(value: boolean) {
    activeRef.current = value;
    setActive(value);
  }

  function ensurePrimaryStt(): SttProvider {
    if (!primarySttRef.current) {
      primarySttRef.current = new SpeachesStt({ baseUrl: "/api/speaches" });
    }
    return primarySttRef.current;
  }

  async function ensureFallbackStt(): Promise<SttProvider> {
    if (!fallbackSttRef.current) {
      const { BrowserWhisperStt } = await import("@nexus/voice-kit/stt-browser-whisper");
      fallbackSttRef.current = new BrowserWhisperStt({ model: "Xenova/whisper-base.en" });
    }
    return fallbackSttRef.current;
  }

  async function transcribeAudio(audio: Blob) {
    if (!mountedRef.current) return;
    setError("");
    setTranscribing(true);
    setStatus("transcribing");

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
      setLastTranscript(transcript);
      setStatus(transcript ? `stt:${result.provider}` : "no speech");
      if (transcript) {
        onTranscript?.(transcript);
      }
    } catch (transcribeError) {
      console.error("Voice transcription failed", transcribeError);
      setStatus("error");
      setError(transcribeError instanceof Error ? transcribeError.message : "Voice transcription failed");
    } finally {
      setTranscribing(false);
      setLevel(0);
    }
  }

  async function startVadToggleSession() {
    if (vadRef.current) {
      await vadRef.current.start();
      usingVadRef.current = true;
      setActiveState(true);
      setStatus("listening");
      return;
    }

    const { createSileroVadSession } = await import("@nexus/voice-kit/vad-silero");
    const vad = await createSileroVadSession({
      onSpeechStart: () => {
        setStatus("speech");
      },
      onSpeechEnd: async (pcm) => {
        const wav = new Blob([float32ToWavBuffer(pcm)], { type: "audio/wav" });
        await transcribeAudio(wav);
        if (mountedRef.current && activeRef.current) {
          setStatus("listening");
        }
      },
      onFrameProcessed: ({ rms }) => {
        setLevel(Math.min(1, rms * 12));
      },
      onStatus: (nextStatus) => {
        if (nextStatus === "listening") {
          setStatus("listening");
        }
      },
    });

    vadRef.current = vad;
    await vad.start();
    usingVadRef.current = true;
    setActiveState(true);
    setStatus("listening");
  }

  async function startRecorderSession(kind: InputMode) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Browser microphone capture is unavailable");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    recorderChunksRef.current = [];
    mediaStreamRef.current = stream;
    mediaRecorderRef.current = recorder;
    usingVadRef.current = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recorderChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(recorderChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      mediaRecorderRef.current = null;
      recorderChunksRef.current = [];
      stopStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      if (!mountedRef.current) {
        activeRef.current = false;
        return;
      }
      if (mountedRef.current) {
        setActiveState(false);
      } else {
        activeRef.current = false;
      }
      if (blob.size > 0) {
        void transcribeAudio(blob);
      } else {
        setStatus("idle");
      }
    };

    recorder.start();
    setActiveState(true);
    setStatus(kind === "hold" ? "recording" : "listening");
  }

  async function startListening() {
    if (active || transcribing) return;
    setError("");
    setStatus("connecting");

    try {
      if (inputMode === "toggle") {
        try {
          await startVadToggleSession();
        } catch (vadError) {
          console.warn("Silero VAD unavailable, using MediaRecorder fallback", vadError);
          await startRecorderSession("toggle");
        }
        return;
      }

      await startRecorderSession("hold");
    } catch (startError) {
      console.error("Failed to start voice input", startError);
      setStatus("error");
      setError(startError instanceof Error ? startError.message : "Failed to start voice input");
      setActiveState(false);
    }
  }

  async function stopListening() {
    if (usingVadRef.current) {
      try {
        vadRef.current?.pause();
      } catch (vadError) {
        console.warn("Failed to pause VAD session", vadError);
      }
      setActiveState(false);
      setLevel(0);
      setStatus("idle");
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setStatus("transcribing");
      return;
    }

    await cleanupVoiceResources();
    setStatus("idle");
  }

  async function handleSpeak() {
    if (speaking) {
      playbackStopRef.current?.();
      playbackStopRef.current = null;
      setSpeaking(false);
      setStatus("idle");
      return;
    }
    if (!ttsText?.trim()) return;

    setError("");
    setStatus("synthesizing");

    const abort = new AbortController();
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const running = await resumeAudioContext(audioContextRef.current);
      if (!running) {
        setStatus("tts blocked");
        setError("Audio playback was blocked — click Speak again after interacting with the page.");
        return;
      }

      let stream;
      if (fishApiKey?.trim()) {
        const tts = new FishTts({
          apiKey: fishApiKey,
          referenceId: resolvedVoiceId,
        });
        const res = await tts.speakPcmStream(ttsText, { voice: resolvedVoiceId, signal: abort.signal });
        if (!res.body) throw new Error("Fish TTS returned an empty body");
        stream = { reader: res.body.getReader(), sampleRate: 24_000 };
      } else {
        stream = await fetchFishTtsPcmStream(ttsText, resolvedVoiceId, abort.signal);
      }

      const player = new StreamingPcmPlayer(audioContextRef.current, {
        sampleRate: stream.sampleRate,
        onStart: () => {
          setSpeaking(true);
          setStatus("speaking");
        },
        onBlocked: () => {
          playbackStopRef.current?.();
          setSpeaking(false);
          setStatus("tts blocked");
        },
        onSilent: () => {
          playbackStopRef.current?.();
          setSpeaking(false);
          setStatus("idle");
        },
      });
      playbackStopRef.current = () => {
        abort.abort();
        player.stop();
      };
      await player.consume(stream.reader);
      playbackStopRef.current = null;
      setStatus("idle");
    } catch (speakError) {
      if (abort.signal.aborted) {
        setStatus("idle");
        return;
      }
      console.error("Fish TTS playback failed", speakError);
      setStatus("error");
      setError(speakError instanceof Error ? speakError.message : "Fish TTS playback failed");
    } finally {
      setSpeaking(false);
      playbackStopRef.current = null;
    }
  }

  return (
    <div className="chat-voice-dock card">
      <div className="chat-voice-dock-copy">
        <strong>Voice dock</strong>
        <p className="muted">
          {inputMode === "hold"
            ? "Hold to record with MediaRecorder."
            : "Click to keep the mic open. Silero VAD auto-sends utterances."}
        </p>
        <div className="chat-voice-meter" aria-hidden="true">
          <span className="chat-voice-meter-bar" style={{ transform: `scaleX(${Math.max(0.04, level)})` }} />
        </div>
        <p className="muted">
          Status: {status}
          {lastTranscript ? ` · Last: ${lastTranscript}` : ""}
        </p>
        {error ? <p className="badge bad">{error}</p> : null}
      </div>

      <div className="chat-voice-dock-actions">
        <div className="toggle">
          <button
            type="button"
            className={inputMode === "hold" ? "active" : ""}
            onClick={() => setInputMode("hold")}
            disabled={active || transcribing}
          >
            Hold
          </button>
          <button
            type="button"
            className={inputMode === "toggle" ? "active" : ""}
            onClick={() => setInputMode("toggle")}
            disabled={active || transcribing}
          >
            Toggle
          </button>
        </div>

        {inputMode === "hold" ? (
          <button
            type="button"
            className={active ? "" : "secondary"}
            onPointerDown={() => void startListening()}
            onPointerUp={() => void stopListening()}
            onPointerLeave={() => {
              if (active) void stopListening();
            }}
            onPointerCancel={() => void stopListening()}
            disabled={transcribing}
          >
            {active ? "Release to send" : "Hold to talk"}
          </button>
        ) : (
          <button
            type="button"
            className={active ? "" : "secondary"}
            onClick={() => void (active ? stopListening() : startListening())}
            disabled={transcribing}
          >
            {active ? "Stop listening" : "Start listening"}
          </button>
        )}

        {ttsText ? (
          <button
            type="button"
            className="secondary"
            onClick={() => void handleSpeak()}
            disabled={!canSpeak}
            title={fishConfigured === false ? "TTS needs FISH_API_KEY on oc-controller" : undefined}
          >
            {speaking ? "Stop reply audio" : "Speak last reply"}
          </button>
        ) : null}
      </div>
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
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
