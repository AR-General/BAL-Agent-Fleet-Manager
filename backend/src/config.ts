import "dotenv/config";

function requireChatEncryptionKey(): string {
  const hex = (process.env.CHAT_ENCRYPTION_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "CHAT_ENCRYPTION_KEY must be set to 32-byte hex (64 chars). Generate with: openssl rand -hex 32",
    );
  }
  return hex;
}

export const config = {
  port: Number(process.env.OC_CONTROLLER_APP_PORT || process.env.OP_CONTROLLER_APP_PORT || 3800),
  logLevel: process.env.LOG_LEVEL || "info",
  /** Console HTTP lines: quiet (4xx/5xx only), all (every API request), off */
  httpAccessConsole: (process.env.HTTP_ACCESS_CONSOLE || "quiet") as "quiet" | "all" | "off",
  auditLogEnabled: process.env.AUDIT_LOG_ENABLED !== "false",
  auditLogDir: process.env.AUDIT_LOG_DIR || "data/audit",
  auditLogRetentionDays: Number(process.env.AUDIT_LOG_RETENTION_DAYS || 30),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgresql://occontroller:occontroller@127.0.0.1:25432/oc_controller",
  jwtSecret: process.env.JWT_SECRET || "dev-jwt-secret-change-me",
  jwtAccessTtlSec: Number(process.env.JWT_ACCESS_TTL_SEC || 900),
  /** Portal login session length (refresh token); default 30d (sliding on each refresh) */
  jwtRefreshTtlSec: Number(process.env.JWT_REFRESH_TTL_SEC || 2_592_000),
  refreshTokenPepper: process.env.REFRESH_TOKEN_PEPPER || process.env.JWT_SECRET || "pepper",
  chatEncryptionKey: requireChatEncryptionKey(),
  adminEmail: process.env.ADMIN_EMAIL || "admin@localhost",
  adminPassword: process.env.ADMIN_PASSWORD || "changeme",
  defaultHost: process.env.OP_CONTROLLER_DEFAULT_HOST || process.env.OC_CONTROLLER_DEFAULT_HOST || "host.docker.internal",
  controllerSecret: process.env.OC_CONTROLLER_SECRET || process.env.OP_CONTROLLER_SECRET || "",
  healthPingIntervalMs: Number(process.env.HEALTH_PING_INTERVAL_MS || 300_000),
  fleetChatModel: process.env.FLEET_CHAT_MODEL || "openai/gpt-4o-mini",
  /** Fallback when instance has no encrypted token (single-agent local dev only). */
  defaultGatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  twilioBridgeInternalUrl:
    process.env.TWILIO_BRIDGE_INTERNAL_URL || "http://127.0.0.1:5080",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || "",
  /** Absolute or repo-relative path to agent workspace trees (markdown, skills). */
  workspaceRoot: process.env.OC_WORKSPACE_ROOT || "",
  speachesUrl: process.env.SPEACHES_URL || "http://127.0.0.1:8090",
  fishApiKey: process.env.FISH_API_KEY || "",
  /** Fish reference_id used when an avatar has no voice configured. */
  fishDefaultVoiceId: process.env.FISH_DEFAULT_VOICE_ID || "",
  /** Optional Artificial Analysis API key for live Intelligence Index (else snapshot). */
  artificialAnalysisApiKey: process.env.ARTIFICIAL_ANALYSIS_API_KEY || "",
  hermesHost: process.env.OC_GATEWAY_HOST || process.env.HERMES_HOST || "127.0.0.1",
  /** Secondary host used when the primary agent gateway is unreachable. */
  hermesHostFallback: process.env.OC_GATEWAY_HOST_FALLBACK || process.env.HERMES_HOST_FALLBACK || "",
  portBases: {
    gateway: 18789,
    bridge: 18790,
    https: 8443,
    signal: 8383,
    twilio: 18792,
    ollama: 11434,
    stride: 100,
  },
  /** Drop-in directory of `.vrm` files (scanned; metadata stored in DB). */
  vrmLibraryDir: process.env.OC_VRM_DIR || "data/vrm-library",
  /** Uploaded VRM blobs (one file per DB row). */
  vrmUploadDir: process.env.OC_VRM_UPLOAD_DIR || "data/vrm-uploads",
  vrmMaxBytes: Number(process.env.OC_VRM_MAX_BYTES || 67_108_864),
} as const;
