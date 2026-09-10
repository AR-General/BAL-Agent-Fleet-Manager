CREATE TYPE "public"."agent_image_type" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TYPE "public"."author_type" AS ENUM('user', 'instance', 'contact', 'system');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('phone', 'signal', 'sms', 'whatsapp', 'email', 'slack', 'twilio_voice', 'webchat', 'other');--> statement-breakpoint
CREATE TYPE "public"."chat_session_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."chat_session_type" AS ENUM('direct', 'group');--> statement-breakpoint
CREATE TYPE "public"."contact_kind" AS ENUM('human', 'ai_agent');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('smartphone', 'esim_device', 'signal_device', 'softphone');--> statement-breakpoint
CREATE TYPE "public"."fleet_message_status" AS ENUM('pending', 'delivered', 'read');--> statement-breakpoint
CREATE TYPE "public"."instance_channel_type" AS ENUM('signal', 'slack', 'twilio_voice', 'twilio_sms', 'whatsapp', 'email', 'instagram', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."participant_type" AS ENUM('user', 'instance', 'contact');--> statement-breakpoint
CREATE TYPE "public"."phone_number_type" AS ENUM('virtual_twilio', 'esim', 'physical_sim');--> statement-breakpoint
CREATE TYPE "public"."team_member_type" AS ENUM('instance', 'agent');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TABLE "agent_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_profile_id" uuid NOT NULL,
	"image_type" "agent_image_type" NOT NULL,
	"image_data" "bytea" NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"display_name" text,
	"role_description" text,
	"public_bio" text,
	"internal_notes" text,
	"is_public" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"channel_type" "instance_channel_type" NOT NULL,
	"enabled" boolean DEFAULT false,
	"config" jsonb DEFAULT '{}'::jsonb,
	"status" text,
	"last_verified" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"author_type" "author_type" DEFAULT 'user' NOT NULL,
	"author_user_id" uuid,
	"author_instance_id" uuid,
	"author_contact_id" uuid,
	"content_encrypted" "bytea",
	"content_iv" "bytea",
	"content_search_hash" text,
	"tool_call_id" text,
	"tool_name" text,
	"tool_result_encrypted" "bytea",
	"tool_result_iv" "bytea",
	"error_info" jsonb,
	"token_usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_type" "participant_type" NOT NULL,
	"user_id" uuid,
	"instance_id" uuid,
	"contact_id" uuid,
	"display_name" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"title" text,
	"session_type" "chat_session_type" DEFAULT 'direct' NOT NULL,
	"target_instance_ids" uuid[],
	"model_id" text,
	"thinking_enabled" boolean DEFAULT false,
	"status" "chat_session_status" DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel_type" "channel_type" NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"priority" integer DEFAULT 0,
	"inbound_ok" boolean DEFAULT true,
	"outbound_ok" boolean DEFAULT true,
	"is_primary" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"contact_kind" "contact_kind" NOT NULL,
	"notes" text,
	"tags" text[] DEFAULT '{}',
	"is_external" boolean DEFAULT false,
	"allow_contact" boolean DEFAULT true,
	"linked_user_id" uuid,
	"linked_instance_id" uuid,
	"linked_agent_profile_id" uuid,
	"status" "contact_status" DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_phone_numbers" (
	"device_id" uuid NOT NULL,
	"phone_number_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"device_type" "device_type" NOT NULL,
	"serial_or_imei" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_instance_id" uuid NOT NULL,
	"to_instance_id" uuid,
	"to_contact_id" uuid,
	"channel" text DEFAULT 'oc-controller' NOT NULL,
	"body_encrypted" "bytea",
	"body_iv" "bytea",
	"status" "fleet_message_status" DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "health_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"status" text NOT NULL,
	"response_time_ms" integer,
	"error" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"primary_team_id" uuid,
	"identity" jsonb DEFAULT '{}'::jsonb,
	"ports" jsonb DEFAULT '{}'::jsonb,
	"host" text,
	"urls" jsonb DEFAULT '{}'::jsonb,
	"channels" jsonb DEFAULT '{}'::jsonb,
	"health" jsonb DEFAULT '{"status":"unknown","consecutive_failures":0}'::jsonb,
	"status" text DEFAULT 'registered',
	"gateway_token_encrypted" text,
	"registered_at" timestamp with time zone DEFAULT now(),
	"last_seen" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"label" text,
	"number_type" "phone_number_type" NOT NULL,
	"inbound_enabled" boolean DEFAULT true,
	"outbound_enabled" boolean DEFAULT true,
	"voice_enabled" boolean DEFAULT false,
	"sms_enabled" boolean DEFAULT false,
	"whatsapp_enabled" boolean DEFAULT false,
	"assigned_instance_id" uuid,
	"assigned_device_id" uuid,
	"twilio_sid" text,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_numbers_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"member_type" "team_member_type" NOT NULL,
	"instance_id" uuid NOT NULL,
	"agent_profile_id" uuid,
	"role_in_team" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "twilio_usage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"instance_id" uuid,
	"period" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"role" "user_role" DEFAULT 'operator' NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_images" ADD CONSTRAINT "agent_images_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_configs" ADD CONSTRAINT "channel_configs_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_instance_id_instances_id_fk" FOREIGN KEY ("author_instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_contact_id_contacts_id_fk" FOREIGN KEY ("author_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_participants" ADD CONSTRAINT "chat_session_participants_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_participants" ADD CONSTRAINT "chat_session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_participants" ADD CONSTRAINT "chat_session_participants_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_participants" ADD CONSTRAINT "chat_session_participants_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_linked_instance_id_instances_id_fk" FOREIGN KEY ("linked_instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_linked_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("linked_agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_phone_numbers" ADD CONSTRAINT "device_phone_numbers_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_phone_numbers" ADD CONSTRAINT "device_phone_numbers_phone_number_id_phone_numbers_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_numbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_events" ADD CONSTRAINT "fleet_events_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_messages" ADD CONSTRAINT "fleet_messages_from_instance_id_instances_id_fk" FOREIGN KEY ("from_instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_messages" ADD CONSTRAINT "fleet_messages_to_instance_id_instances_id_fk" FOREIGN KEY ("to_instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_messages" ADD CONSTRAINT "fleet_messages_to_contact_id_contacts_id_fk" FOREIGN KEY ("to_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_log" ADD CONSTRAINT "health_log_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_api_tokens" ADD CONSTRAINT "instance_api_tokens_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_api_tokens" ADD CONSTRAINT "instance_api_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_primary_team_id_teams_id_fk" FOREIGN KEY ("primary_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_assigned_instance_id_instances_id_fk" FOREIGN KEY ("assigned_instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twilio_usage_snapshots" ADD CONSTRAINT "twilio_usage_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twilio_usage_snapshots" ADD CONSTRAINT "twilio_usage_snapshots_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profiles_instance_agent" ON "agent_profiles" USING btree ("instance_id","agent_id");--> statement-breakpoint
CREATE INDEX "chat_messages_session_created" ON "chat_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_slug" ON "contacts" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "fleet_events_instance_created" ON "fleet_events" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE INDEX "health_log_instance_ts" ON "health_log" USING btree ("instance_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "instances_tenant_slug" ON "instances" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_unique" ON "team_members" USING btree ("team_id","instance_id","agent_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_tenant_slug" ON "teams" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email" ON "users" USING btree ("tenant_id","email");