import { useEffect, useState } from "react";
import { api } from "../api/client";
import {
  DEFAULT_FISH_VOICE_ID,
  FISH_LIBRARY_VOICES,
  type FishVoice,
  type FishVoicesResponse,
} from "../lib/fishVoices";

type State = {
  voices: FishVoice[];
  defaultVoiceId: string;
  fishConfigured: boolean | null;
  loading: boolean;
  error: string;
};

const INITIAL: State = {
  voices: FISH_LIBRARY_VOICES,
  defaultVoiceId: DEFAULT_FISH_VOICE_ID,
  fishConfigured: null,
  loading: true,
  error: "",
};

let inflight: Promise<FishVoicesResponse> | null = null;

function loadVoices(): Promise<FishVoicesResponse> {
  if (!inflight) {
    inflight = api<FishVoicesResponse>("/voice/voices").catch((err) => {
      inflight = null;
      throw err;
    });
  }
  return inflight;
}

export function useFishVoices(): State {
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    void loadVoices()
      .then((payload) => {
        if (cancelled) return;
        const voices = payload.voices?.length ? payload.voices : FISH_LIBRARY_VOICES;
        setState({
          voices,
          defaultVoiceId: payload.default_voice_id?.trim() || DEFAULT_FISH_VOICE_ID,
          fishConfigured: Boolean(payload.fish_configured),
          loading: false,
          error: "",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          ...INITIAL,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load Fish voices",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
