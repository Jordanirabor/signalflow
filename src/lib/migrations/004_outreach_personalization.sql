-- Intelligent Outreach Personalization — Schema Extensions
-- Requirements: 1.4, 2.8, 3.6

-- ============================================================
-- EXTEND ICP TABLE WITH ENRICHMENT FIELDS
-- ============================================================

ALTER TABLE icp ADD COLUMN IF NOT EXISTS product_description TEXT;
ALTER TABLE icp ADD COLUMN IF NOT EXISTS value_proposition TEXT;
ALTER TABLE icp ADD COLUMN IF NOT EXISTS pain_points_solved TEXT[];
ALTER TABLE icp ADD COLUMN IF NOT EXISTS competitor_context TEXT;
ALTER TABLE icp ADD COLUMN IF NOT EXISTS ideal_customer_characteristics TEXT;
ALTER TABLE icp ADD COLUMN IF NOT EXISTS enrichment_generated_at TIMESTAMPTZ;

-- ============================================================
-- EXTEND LEAD TABLE WITH RESEARCH PROFILE AND CORRELATION COLUMNS
-- ============================================================

ALTER TABLE lead ADD COLUMN IF NOT EXISTS research_profile JSONB;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS correlation_score NUMERIC(4,3);
ALTER TABLE lead ADD COLUMN IF NOT EXISTS correlation_breakdown JSONB;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS correlation_flag VARCHAR(20);

-- ============================================================
-- UPDATE ENRICHMENT_STATUS CHECK CONSTRAINT
-- Add 'researching' status required by the Prospect Researcher
-- ============================================================

ALTER TABLE lead DROP CONSTRAINT IF EXISTS lead_enrichment_status_check;
ALTER TABLE lead ADD CONSTRAINT lead_enrichment_status_check
  CHECK (enrichment_status IN ('pending', 'complete', 'partial', 'researching'));

-- ============================================================
-- INDEXES
-- ============================================================

-- Efficient sorting/filtering by correlation score
CREATE INDEX IF NOT EXISTS idx_lead_correlation_score
  ON lead (correlation_score DESC)
  WHERE is_deleted = false AND correlation_score IS NOT NULL;

-- Filter low-correlation leads from outreach
CREATE INDEX IF NOT EXISTS idx_lead_correlation_flag
  ON lead (correlation_flag)
  WHERE is_deleted = false AND correlation_flag IS NOT NULL;
