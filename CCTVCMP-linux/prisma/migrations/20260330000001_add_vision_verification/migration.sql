-- Vision verification result stored per EdgeReport.
-- Populated by the CMP after re-analysing the image sent by the edge device
-- using a vision-capable LLM, then reconciling with text-classifier output.
ALTER TABLE "edge_reports"
ADD COLUMN IF NOT EXISTS "vision_verification_json" JSONB;
