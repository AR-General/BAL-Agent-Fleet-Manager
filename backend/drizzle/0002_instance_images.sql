CREATE TABLE IF NOT EXISTS "instance_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"image_type" "agent_image_type" NOT NULL,
	"image_data" bytea NOT NULL,
	"mime_type" text NOT NULL,
	"label" text,
	"probability" integer,
	"sort_order" integer DEFAULT 0,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instance_images" ADD CONSTRAINT "instance_images_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instance_images_instance_id_idx" ON "instance_images" USING btree ("instance_id");
