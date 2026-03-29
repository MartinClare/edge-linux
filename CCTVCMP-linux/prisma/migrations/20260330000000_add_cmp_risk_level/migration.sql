-- CMP independent risk reassessment column.
-- Stores the risk level CMP derived from its own analysis (LLM classifier + alarm rules)
-- so UI can display both the edge-reported risk and the CMP-assessed risk side by side.
ALTER TABLE "edge_reports"
ADD COLUMN IF NOT EXISTS "cmp_risk_level" TEXT;
