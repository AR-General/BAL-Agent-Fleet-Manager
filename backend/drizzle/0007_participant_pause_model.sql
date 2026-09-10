-- Per-participant pause (ignore everything) and model override

ALTER TABLE "chat_session_participants" ADD COLUMN IF NOT EXISTS "paused" boolean DEFAULT false NOT NULL;
ALTER TABLE "chat_session_participants" ADD COLUMN IF NOT EXISTS "model_id" text;
