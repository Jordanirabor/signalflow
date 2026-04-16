-- Multi-ICP Profile Migration
-- Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.6

-- ============================================================
-- Step 1: Create icp_profile table
-- ============================================================
CREATE TABLE IF NOT EXISTS icp_profile (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id     UUID NOT NULL REFERENCES founder(id),
  target_role    VARCHAR(255) NOT NULL,
  industry       VARCHAR(255) NOT NULL,
  company_stage  VARCHAR(255),
  geography      VARCHAR(255),
  pain_points    TEXT[] NOT NULL DEFAULT '{}',
  buying_signals TEXT[] NOT NULL DEFAULT '{}',
  custom_tags    TEXT[],
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_pain_points_length
    CHECK (array_length(pain_points, 1) IS NULL OR
           (array_length(pain_points, 1) >= 1 AND array_length(pain_points, 1) <= 10)),
  CONSTRAINT chk_buying_signals_length
    CHECK (array_length(buying_signals, 1) IS NULL OR
           (array_length(buying_signals, 1) >= 1 AND array_length(buying_signals, 1) <= 5))
);

CREATE INDEX IF NOT EXISTS idx_icp_profile_founder ON icp_profile (founder_id);
CREATE INDEX IF NOT EXISTS idx_icp_profile_active ON icp_profile (founder_id) WHERE is_active = true;

-- ============================================================
-- Step 2: Migrate existing ICP records into icp_profile
-- ============================================================
INSERT INTO icp_profile (id, founder_id, target_role, industry, company_stage, geography, pain_points, buying_signals, custom_tags, is_active)
SELECT id, founder_id, target_role, industry, company_stage, geography,
       COALESCE(pain_points_solved, '{}'), '{}', custom_tags, true
FROM icp
WHERE NOT EXISTS (SELECT 1 FROM icp_profile WHERE icp_profile.id = icp.id);

-- ============================================================
-- Step 3: Add icp_profile_id column to lead table
-- ============================================================
ALTER TABLE lead ADD COLUMN IF NOT EXISTS icp_profile_id UUID REFERENCES icp_profile(id) ON DELETE SET NULL;

-- ============================================================
-- Step 4: Backfill lead.icp_profile_id from founder's migrated profile
-- ============================================================
UPDATE lead l
SET icp_profile_id = (
  SELECT ip.id FROM icp_profile ip
  WHERE ip.founder_id = l.founder_id
  ORDER BY ip.created_at ASC
  LIMIT 1
)
WHERE l.icp_profile_id IS NULL;

-- ============================================================
-- Step 5: Add index on lead.icp_profile_id
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_lead_icp_profile ON lead (icp_profile_id);
