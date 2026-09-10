/**
 * Keeps the chat window and a popped-out 3D window on the same session.
 * The scene window has its own WebSocket / TTS / lip-sync; this channel only
 * coordinates open/close and a few live UI commands.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseScenePopoutMessage,
  SCENE_POPOUT_CHANNEL,
  scenePopoutUrl,
  scenePopoutWindowName,
  type ScenePopoutMessage,
  type ScenePopoutRole,
} from "../lib/scenePopout";
import type { TtsQueueState } from "./useStreamingTts";

type Args = {
  sessionId?: string;
  role: ScenePopoutRole;
  onLookAt?: (slug: string, token: number) => void;
  onConfig?: (slug: string, token: number) => void;
  onTranscript?: (text: string) => void;
  onTtsCancelCurrent?: () => void;
  onTtsCancelQueue?: () => void;
  onTtsQueueState?: (state: TtsQueueState) => void;
};

function post(channel: BroadcastChannel | null, msg: ScenePopoutMessage): void {
  try {
    channel?.postMessage(msg);
  } catch (err) {
    console.warn("[scene-popout] post failed", err);
  }
}

export function useScenePopout({
  sessionId,
  role,
  onLookAt,
  onConfig,
  onTranscript,
  onTtsCancelCurrent,
  onTtsCancelQueue,
  onTtsQueueState,
}: Args): {
  popped: boolean;
  dismissed: boolean;
  open: () => void;
  restore: () => void;
  dismiss: () => void;
  postLookAt: (slug: string, token: number) => void;
  postConfig: (slug: string, token: number) => void;
  postTranscript: (text: string) => void;
  postTtsCancelCurrent: () => void;
  postTtsCancelQueue: () => void;
  postTtsQueueState: (state: TtsQueueState) => void;
} {
  const [popped, setPopped] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const winRef = useRef<Window | null>(null);
  const prevSessionRef = useRef(sessionId);
  const sessionRef = useRef(sessionId);
  const lookAtRef = useRef(onLookAt);
  const configRef = useRef(onConfig);
  const transcriptRef = useRef(onTranscript);
  const cancelCurrentRef = useRef(onTtsCancelCurrent);
  const cancelQueueRef = useRef(onTtsCancelQueue);
  const queueStateRef = useRef(onTtsQueueState);
  sessionRef.current = sessionId;
  lookAtRef.current = onLookAt;
  configRef.current = onConfig;
  transcriptRef.current = onTranscript;
  cancelCurrentRef.current = onTtsCancelCurrent;
  cancelQueueRef.current = onTtsCancelQueue;
  queueStateRef.current = onTtsQueueState;

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SCENE_POPOUT_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (ev) => {
      const msg = parseScenePopoutMessage(ev.data);
      if (!msg || msg.sessionId !== sessionRef.current) return;
      if (role === "chat") {
        if (msg.type === "opened") setPopped(true);
        if (msg.type === "closed") {
          setPopped(false);
          winRef.current = null;
        }
        if (msg.type === "transcript") transcriptRef.current?.(msg.text);
        if (msg.type === "tts-queue") {
          queueStateRef.current?.({
            speaking: msg.speaking,
            speakingSlug: msg.speakingSlug,
            queueLength: msg.queueLength,
          });
        }
        return;
      }
      if (msg.type === "ping") {
        post(channel, { type: "opened", sessionId: msg.sessionId });
        return;
      }
      if (msg.type === "restore") {
        setDismissed(true);
        window.close();
        return;
      }
      if (msg.type === "look-at") lookAtRef.current?.(msg.slug, msg.token);
      if (msg.type === "config") configRef.current?.(msg.slug, msg.token);
      if (msg.type === "tts-cancel-current") cancelCurrentRef.current?.();
      if (msg.type === "tts-cancel-queue") cancelQueueRef.current?.();
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [role]);

  useEffect(() => {
    if (role !== "scene" || !sessionId) return;
    post(channelRef.current, { type: "opened", sessionId });
    const previousTitle = document.title;
    document.title = `3D · ${document.title.replace(/^3D · /, "")}`;
    const onUnload = () => post(channelRef.current, { type: "closed", sessionId });
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.title = previousTitle;
      window.removeEventListener("beforeunload", onUnload);
      post(channelRef.current, { type: "closed", sessionId });
    };
  }, [role, sessionId]);

  useEffect(() => {
    if (role !== "chat" || !sessionId) return;
    post(channelRef.current, { type: "ping", sessionId });
    const timer = window.setInterval(() => {
      if (winRef.current?.closed) {
        setPopped(false);
        winRef.current = null;
      }
    }, 800);
    return () => window.clearInterval(timer);
  }, [role, sessionId]);

  useEffect(() => {
    if (role !== "chat") return;
    const prev = prevSessionRef.current;
    if (prev && prev !== sessionId) {
      post(channelRef.current, { type: "restore", sessionId: prev });
      try {
        winRef.current?.close();
      } catch {
        /* ignore */
      }
      winRef.current = null;
      setPopped(false);
    }
    prevSessionRef.current = sessionId;
  }, [role, sessionId]);

  const open = useCallback(() => {
    if (!sessionId) return;
    const url = scenePopoutUrl(sessionId);
    const name = scenePopoutWindowName(sessionId);
    const features = "popup=yes,width=1280,height=800,menubar=no,toolbar=no";
    const win = window.open(url, name, features);
    if (!win) {
      console.warn("[scene-popout] popup blocked", { sessionId });
      return;
    }
    winRef.current = win;
    setPopped(true);
    console.info("[scene-popout] opened", { sessionId });
  }, [sessionId]);

  const restore = useCallback(() => {
    if (!sessionId) return;
    post(channelRef.current, { type: "restore", sessionId });
    try {
      winRef.current?.close();
    } catch {
      /* ignore */
    }
    winRef.current = null;
    setPopped(false);
    console.info("[scene-popout] restored", { sessionId });
  }, [sessionId]);

  const dismiss = useCallback(() => {
    if (!sessionId) return;
    post(channelRef.current, { type: "closed", sessionId });
    setDismissed(true);
    window.close();
    console.info("[scene-popout] dismissed", { sessionId });
  }, [sessionId]);

  const postLookAt = useCallback(
    (slug: string, token: number) => {
      if (!sessionId) return;
      post(channelRef.current, { type: "look-at", sessionId, slug, token });
    },
    [sessionId],
  );
  const postConfig = useCallback(
    (slug: string, token: number) => {
      if (!sessionId) return;
      post(channelRef.current, { type: "config", sessionId, slug, token });
    },
    [sessionId],
  );
  const postTranscript = useCallback(
    (text: string) => {
      if (!sessionId) return;
      post(channelRef.current, { type: "transcript", sessionId, text });
    },
    [sessionId],
  );
  const postTtsCancelCurrent = useCallback(() => {
    if (!sessionId) return;
    post(channelRef.current, { type: "tts-cancel-current", sessionId });
  }, [sessionId]);
  const postTtsCancelQueue = useCallback(() => {
    if (!sessionId) return;
    post(channelRef.current, { type: "tts-cancel-queue", sessionId });
  }, [sessionId]);
  const postTtsQueueState = useCallback(
    (state: TtsQueueState) => {
      if (!sessionId) return;
      post(channelRef.current, {
        type: "tts-queue",
        sessionId,
        speaking: state.speaking,
        speakingSlug: state.speakingSlug,
        queueLength: state.queueLength,
      });
    },
    [sessionId],
  );

  return {
    popped,
    dismissed,
    open,
    restore,
    dismiss,
    postLookAt,
    postConfig,
    postTranscript,
    postTtsCancelCurrent,
    postTtsCancelQueue,
    postTtsQueueState,
  };
}
