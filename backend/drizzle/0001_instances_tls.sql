ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "tls" jsonb DEFAULT '{}'::jsonb NOT NULL;
