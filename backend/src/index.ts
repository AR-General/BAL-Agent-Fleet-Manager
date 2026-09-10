import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { httpAccessMiddleware } from "./middleware/httpAccess.js";
import { log } from "./utils/logger.js";
import {
  startAuditLogMaintenance,
  stopAuditLogMaintenance,
} from "./services/requestAudit.js";
import { closeDb, getPool } from "./db/client.js";
import { startHealthPinger, stopHealthPinger } from "./services/healthPinger.js";
import authRouter from "./routes/auth.js";
import instancesRouter from "./routes/instances.js";
import instanceTokensRouter from "./routes/instance-tokens.js";
import healthRouter from "./routes/health.js";
import eventsRouter from "./routes/events.js";
import messagesRouter from "./routes/messages.js";
import chatRouter from "./routes/chat.js";
import adminRouter from "./routes/admin.js";
import teamsRouter from "./routes/teams.js";
import contactsRouter from "./routes/contacts.js";
import toolsRouter from "./routes/tools.js";
import agentsRouter from "./routes/agents.js";
import phoneNumbersRouter from "./routes/phone-numbers.js";
import devicesRouter from "./routes/devices.js";
import channelsRouter from "./routes/channels.js";
import instanceImagesRouter from "./routes/instance-images.js";
import statsRouter from "./routes/stats.js";
import workspaceRouter from "./routes/workspace.js";
import presenceRouter from "./routes/presence.js";
import voiceRouter from "./routes/voice.js";
import workspaceSettingsRouter from "./routes/workspaceSettings.js";
import llmMetaRouter from "./routes/llmMeta.js";
import vrmModelsRouter from "./routes/vrm-models.js";
import { attachChatWebSocket } from "./services/chatWs.js";
import { renderPrometheus } from "./utils/metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  await getPool().query("SELECT 1");

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "8mb" }));
  app.use(httpAccessMiddleware(log));
  startAuditLogMaintenance();

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "oc-controller" });
  });
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(renderPrometheus());
  });

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/instances", instancesRouter);
  app.use("/api/v1/instances/:slug/tokens", instanceTokensRouter);
  app.use("/api/v1/instances/:slug/images", instanceImagesRouter);
  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/events", eventsRouter);
  app.use("/api/v1/messages", messagesRouter);
  app.use("/api/v1/chat", chatRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1/teams", teamsRouter);
  app.use("/api/v1/contacts", contactsRouter);
  app.use("/api/v1/tools", toolsRouter);
  app.use("/api/v1/agents", agentsRouter);
  app.use("/api/v1/phone-numbers", phoneNumbersRouter);
  app.use("/api/v1/devices", devicesRouter);
  app.use("/api/v1/channels", channelsRouter);
  app.use("/api/v1/stats", statsRouter);
  app.use("/api/v1/workspace", workspaceRouter);
  app.use("/api/v1/presence", presenceRouter);
  app.use("/api/v1/voice", voiceRouter);
  app.use("/api/v1/workspace-settings", workspaceSettingsRouter);
  app.use("/api/v1/llm-meta", llmMetaRouter);
  app.use("/api/v1/vrm-models", vrmModelsRouter);

  const publicDir = path.join(__dirname, "..", "public");
  app.use(
    express.static(publicDir, {
      setHeaders(res, filePath) {
        if (/\.(vrm|vrma)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(publicDir, "index.html"), (err) => {
      if (err) next();
    });
  });

  const server = app.listen(config.port, () => {
    log.info({ port: config.port }, "oc-controller listening");
    startHealthPinger();
  });
  attachChatWebSocket(server);

  const shutdown = async () => {
    stopHealthPinger();
    stopAuditLogMaintenance();
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
