import { useEffect, useRef, useState } from "react";
import { ensureFreshAccessToken, getAccessToken } from "../api/client";

type SocketMessage = {
  type?: string;
  message_id?: string;
  content?: string;
  delta?: string;
  [key: string]: unknown;
};

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 800;

function nextBackoff(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempt, 6));
}

export function useChatWebSocket(sessionId: string | undefined, onMessage: (data: unknown) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  const sessionIdRef = useRef(sessionId);
  const streamingRef = useRef<Record<string, string>>({});
  const attemptRef = useRef(0);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && sessionId) {
      ws.send(JSON.stringify({ type: "subscribe", session_id: sessionId }));
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    let ping: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;

    function clearTimers() {
      if (ping) {
        clearInterval(ping);
        ping = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function subscribe(ws: WebSocket) {
      const sid = sessionIdRef.current;
      if (sid && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "subscribe", session_id: sid }));
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      const delay = nextBackoff(attemptRef.current);
      attemptRef.current += 1;
      reconnectTimer = setTimeout(() => {
        void connect();
      }, delay);
    }

    async function connect() {
      const myGen = ++generation;
      clearTimers();
      if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
        wsRef.current.close();
      }

      try {
        await ensureFreshAccessToken();
      } catch {
        if (!cancelled && myGen === generation) scheduleReconnect();
        return;
      }
      if (cancelled || myGen !== generation) return;

      const token = getAccessToken();
      if (!token) {
        scheduleReconnect();
        return;
      }

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${proto}//${window.location.host}/api/v1/chat/ws?token=${encodeURIComponent(token)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled || ws !== wsRef.current) return;
        attemptRef.current = 0;
        setConnected(true);
        subscribe(ws);
        onMessageRef.current({ type: "ws_open" });
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as SocketMessage;

          if (parsed.type === "session_sync" && typeof parsed.stream === "object" && parsed.stream) {
            const stream = parsed.stream as { message_id?: string; content?: string };
            if (typeof stream.message_id === "string" && typeof stream.content === "string") {
              streamingRef.current[stream.message_id] = stream.content;
            }
          }

          if (parsed.type === "message_delta" && typeof parsed.message_id === "string") {
            const delta = typeof parsed.delta === "string" ? parsed.delta : parsed.content;
            if (typeof delta === "string") {
              const nextContent = `${streamingRef.current[parsed.message_id] ?? ""}${delta}`;
              streamingRef.current[parsed.message_id] = nextContent;
              onMessageRef.current({ ...parsed, content: nextContent, delta });
              return;
            }
          }

          if (
            (parsed.type === "message" || parsed.type === "message_done") &&
            typeof parsed.message_id === "string"
          ) {
            if (typeof parsed.content === "string") {
              streamingRef.current[parsed.message_id] = parsed.content;
            } else if (streamingRef.current[parsed.message_id]) {
              parsed.content = streamingRef.current[parsed.message_id];
            }

            if (parsed.type === "message_done") {
              delete streamingRef.current[parsed.message_id];
            }
          }

          onMessageRef.current(parsed);
        } catch {
          /* ignore malformed socket payloads */
        }
      };

      ws.onclose = () => {
        if (ws !== wsRef.current) return;
        setConnected(false);
        onMessageRef.current({ type: "ws_close" });
        if (!cancelled) scheduleReconnect();
      };

      ws.onerror = () => {
        if (ws.readyState === WebSocket.OPEN) return;
        ws.close();
      };

      ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);
    }

    function kickIfNeeded() {
      if (cancelled) return;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      attemptRef.current = 0;
      void connect();
    }

    void connect();
    window.addEventListener("online", kickIfNeeded);
    document.addEventListener("visibilitychange", kickIfNeeded);

    return () => {
      cancelled = true;
      generation += 1;
      window.removeEventListener("online", kickIfNeeded);
      document.removeEventListener("visibilitychange", kickIfNeeded);
      clearTimers();
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, []);

  return { connected, socket: wsRef.current };
}
