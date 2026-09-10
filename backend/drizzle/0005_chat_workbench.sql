-- Chat workbench: rooms origin/slug, fleet events tags/encryption, agent presence

CREATE TYPE "public"."chat_session_origin" AS ENUM('human', 'agent_dm', 'named_channel', 'event_mention');
CREATE TYPE "public"."chat_reply_policy" AS ENUM('human_only', 'mentioned_only', 'off');

ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "created_by_instance_id" uuid;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "origin" "chat_session_origin" DEFAULT 'human' NOT NULL;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "reply_policy" "chat_reply_policy" DEFAULT 'human_only' NOT NULL;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "related_event_id" uuid;

DO $$ BEGIN
  ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_created_by_instance_id_instances_id_fk"
    FOREIGN KEY ("created_by_instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "chat_sessions_tenant_updated" ON "chat_sessions" ("tenant_id", "updated_at");
CREATE INDEX IF NOT EXISTS "chat_sessions_tenant_origin" ON "chat_sessions" ("tenant_id", "origin");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_sessions_tenant_slug_unique"
  ON "chat_sessions" ("tenant_id", "slug") WHERE "slug" IS NOT NULL;

ALTER TABLE "fleet_events" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
ALTER TABLE "fleet_events" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "fleet_events" ADD COLUMN IF NOT EXISTS "summary_encrypted" bytea;
ALTER TABLE "fleet_events" ADD COLUMN IF NOT EXISTS "summary_iv" bytea;
ALTER TABLE "fleet_events" ADD COLUMN IF NOT EXISTS "data_encrypted" bytea;
ALTER TABLE "fleet_events" ADD COLUMN IF NOT EXISTS "data_iv" bytea;
ALTER TABLE "fleet_events" ADD COLUMN IF NOT EXISTS "mention_instance_ids" uuid[] DEFAULT '{}' NOT NULL;
ALTER TABLE "fleet_events" ADD COLUMN IF NOT EXISTS "related_session_id" uuid;

DO $$ BEGIN
  ALTER TABLE "fleet_events" ADD CONSTRAINT "fleet_events_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "fleet_events" ADD CONSTRAINT "fleet_events_related_session_id_chat_sessions_id_fk"
    FOREIGN KEY ("related_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "fleet_events_tenant_created" ON "fleet_events" ("tenant_id", "created_at");

-- Backfill tenant_id from instances
UPDATE "fleet_events" fe
SET "tenant_id" = i."tenant_id"
FROM "instances" i
WHERE fe."instance_id" = i."id" AND fe."tenant_id" IS NULL;

CREATE TABLE IF NOT EXISTS "agent_presence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL UNIQUE,
  "agent_profile_id" uuid,
  "vrm_url" text,
  "gesture_manifest_url" text,
  "default_mood" text DEFAULT 'neutral',
  "clothes" jsonb DEFAULT '{}'::jsonb,
  "fish_voice_id" text,
  "pointer_look" boolean DEFAULT true,
  "default_model_id" text,
  "settings" jsonb DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "agent_presence" ADD CONSTRAINT "agent_presence_instance_id_instances_id_fk"
    FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_presence" ADD CONSTRAINT "agent_presence_agent_profile_id_agent_profiles_id_fk"
    FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "event_tag_catalog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "tag" text NOT NULL,
  "description" text,
  "is_standard" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "event_tag_catalog" ADD CONSTRAINT "event_tag_catalog_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "event_tag_catalog_tenant_tag" ON "event_tag_catalog" ("tenant_id", "tag");
