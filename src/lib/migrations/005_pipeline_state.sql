-- ============================================================
-- 005: Persist pipeline state in database
-- ============================================================
-- Moves pipeline state from in-memory variable to pipeline_config
-- so it survives server restarts and module reloads.
-- ============================================================

ALTER TABLE pipeline_config
  ADD COLUMN IF NOT EXISTS pipeline_state VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (pipeline_state IN ('running', 'paused', 'error'));

ALTER TABLE pipeline_config
  ADD COLUMN IF NOT EXISTS pipeline_error TEXT;
