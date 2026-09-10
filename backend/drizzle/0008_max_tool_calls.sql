-- Per-session Hermes tool-calling round cap (DM/solo default 50)

ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "max_tool_calls" integer DEFAULT 50 NOT NULL;
