ALTER TABLE "edge_reports"
ADD COLUMN IF NOT EXISTS "message_type" TEXT NOT NULL DEFAULT 'analysis',
ADD COLUMN IF NOT EXISTS "keepalive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "event_image_included" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "event_image_path" TEXT,
ADD COLUMN IF NOT EXISTS "event_image_mime_type" TEXT,
ADD COLUMN IF NOT EXISTS "event_image_data" BYTEA,
ADD COLUMN IF NOT EXISTS "event_timestamp" TIMESTAMP,
ADD COLUMN IF NOT EXISTS "construction_safety_json" JSONB,
ADD COLUMN IF NOT EXISTS "fire_safety_json" JSONB,
ADD COLUMN IF NOT EXISTS "property_security_json" JSONB;
