-- Group chat: primary responder, max auto turns, message reactions

CREATE TYPE "public"."chat_reaction_kind" AS ENUM('acknowledged', 'ignoring', 'responding');

ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "primary_instance_id" uuid;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "max_agent_auto_turns" integer DEFAULT 5 NOT NULL;

DO $$ BEGIN
  ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_primary_instance_id_instances_id_fk"
    FOREIGN KEY ("primary_instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "chat_message_reactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL,
  "instance_id" uuid NOT NULL,
  "kind" "chat_reaction_kind" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_message_id_chat_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_instance_id_instances_id_fk"
    FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_reactions_message_instance_unique"
  ON "chat_message_reactions" ("message_id", "instance_id");

CREATE INDEX IF NOT EXISTS "chat_message_reactions_message_id_idx"
  ON "chat_message_reactions" ("message_id");
