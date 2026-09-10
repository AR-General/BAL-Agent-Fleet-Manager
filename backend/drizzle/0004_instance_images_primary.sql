ALTER TABLE "instance_images" ADD COLUMN IF NOT EXISTS "is_primary" boolean DEFAULT false NOT NULL;
