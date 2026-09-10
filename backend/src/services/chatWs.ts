import type { Server } from "http";
import jwt from "jsonwebtoken";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "../config.js";
import type { AuthUser } from "../middleware/auth.js";
import { snapshotForClient } from "./sessionLiveState.js";
import { log } from "../utils/logger.js";
import { incMetric, setGauge } from "../utils/metrics.js";

type Client = {
  ws: WebSocket;
  user: AuthUser;
  sessions: Set<string>;
};

const clients = new Set<Client>();

function touchConnectionGauge(): void {
  setGauge("oc_chat_ws_connections", "Authenticated chat websocket clients", clients.size);
}

export function attachChatWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/api/v1/chat/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get("token") || "";
    let user: AuthUser;
    try {
      const payload = jwt.verify(token, config.jwtSecret) as {
        sub: string;
        tid: string;
        role: AuthUser["role"];
        email: string;
      };
      user = {
        id: payload.sub,
        tenantId: payload.tid,
        role: payload.role,
        email: payload.email,
      };
    } catch {
      ws.close(4401, "unauthorized");
      return;
    }

    const client: Client = { ws, user, sessions: new Set() };
    clients.add(client);
    touchConnectionGauge();
    incMetric("oc_chat_ws_connect_total", "Chat websocket connections accepted");

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type: string; session_id?: string };
        if (msg.type === "subscribe" && msg.session_id) {
          client.sessions.add(msg.session_id);
          const snapshot = snapshotForClient(msg.session_id);
          ws.send(JSON.stringify(snapshot));
          ws.send(JSON.stringify({ type: "subscribed", session_id: msg.session_id }));
          log.info(
            {
              sessionId: msg.session_id,
              userId: user.id,
              generating: snapshot.generating,
            },
            "chat ws subscribed; sent session_sync",
          );
        }
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "invalid message" }));
      }
    });

    ws.on("close", () => {
      clients.delete(client);
      touchConnectionGauge();
    });
    ws.send(JSON.stringify({ type: "connected", user_id: user.id }));
  });
}

export function broadcastChatMessage(
  sessionId: string,
  payload: Record<string, unknown>,
): void {
  const data = JSON.stringify({ type: "message", session_id: sessionId, ...payload });
  for (const c of clients) {
    if (c.sessions.has(sessionId) && c.ws.readyState === 1) {
      c.ws.send(data);
    }
  }
}

export function broadcastSessionEvent(
  sessionId: string,
  payload: Record<string, unknown>,
): void {
  const data = JSON.stringify({ session_id: sessionId, ...payload });
  for (const c of clients) {
    if (c.sessions.has(sessionId) && c.ws.readyState === 1) {
      c.ws.send(data);
    }
  }
}

/** Broadcast to all portal WS clients in a tenant (e.g. fleet events). */
export function broadcastTenantEvent(
  tenantId: string,
  payload: Record<string, unknown>,
): void {
  const data = JSON.stringify(payload);
  for (const c of clients) {
    if (c.user.tenantId === tenantId && c.ws.readyState === 1) {
      c.ws.send(data);
    }
  }
}
