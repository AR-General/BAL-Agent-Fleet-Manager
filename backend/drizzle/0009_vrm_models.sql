-- Tenant VRM library: directory-backed meshes + uploaded files (bytes stay on disk).

CREATE TABLE IF NOT EXISTS "vrm_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "source" text NOT NULL,
  "relative_path" text,
  "storage_key" text,
  "original_filename" text,
  "file_size" integer,
  "sha256" text,
  "hidden" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "vrm_models_tenant_dir_path"
  ON "vrm_models" ("tenant_id", "relative_path")
  WHERE "source" = 'directory' AND "relative_path" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "vrm_models_tenant_storage"
  ON "vrm_models" ("tenant_id", "storage_key")
  WHERE "storage_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "vrm_models_tenant_updated"
  ON "vrm_models" ("tenant_id", "updated_at");
