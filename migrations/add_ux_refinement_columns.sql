-- 1. Update tone_preference CHECK constraint (Req 1)
ALTER TABLE pipeline_config
  DROP CONSTRAINT IF EXISTS pipeline_config_tone_preference_check;

ALTER TABLE pipeline_config
  ADD CONSTRAINT pipeline_config_tone_preference_check
  CHECK (tone_preference IN ('warm', 'professional', 'casual', 'direct', 'bold'));

ALTER TABLE pipeline_config
  ALTER COLUMN tone_preference SET DEFAULT 'warm';

-- 2. Add global_steering to pipeline_config (Req 7)
ALTER TABLE pipeline_config
  ADD COLUMN IF NOT EXISTS global_steering TEXT DEFAULT '';

-- 3. Add strategy_scope to pipeline_config (Req 8)
ALTER TABLE pipeline_config
  ADD COLUMN IF NOT EXISTS strategy_scope VARCHAR(20) DEFAULT 'global';

ALTER TABLE pipeline_config
  ADD CONSTRAINT pipeline_config_strategy_scope_check
  CHECK (strategy_scope IN ('global', 'per_project'));

-- 4. Add steering_context to lead (Req 6)
ALTER TABLE lead
  ADD COLUMN IF NOT EXISTS steering_context TEXT DEFAULT '';

-- 5. Add value_proposition and target_pain_points to icp_project (Req 8)
ALTER TABLE icp_project
  ADD COLUMN IF NOT EXISTS value_proposition TEXT DEFAULT '';

ALTER TABLE icp_project
  ADD COLUMN IF NOT EXISTS target_pain_points TEXT[] DEFAULT '{}';
