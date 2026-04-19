-- Migration: Add reliable discovery engine columns
-- Adds enrichment retry tracking and email discovery method columns to lead table,
-- and run summary columns to pipeline_run table.
-- Uses ADD COLUMN IF NOT EXISTS for idempotent execution.

-- Enrichment retry tracking columns on lead table
ALTER TABLE lead ADD COLUMN IF NOT EXISTS enrichment_retry_count INTEGER DEFAULT 0;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS enrichment_next_retry_at TIMESTAMP;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS enrichment_last_error TEXT;

-- Waterfall email discovery tracking columns on lead table
ALTER TABLE lead ADD COLUMN IF NOT EXISTS email_discovery_method TEXT;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS email_discovery_steps JSONB;

-- Pipeline run summary and retry tracking columns
ALTER TABLE pipeline_run ADD COLUMN IF NOT EXISTS run_summary JSONB;
ALTER TABLE pipeline_run ADD COLUMN IF NOT EXISTS enrichments_retried INTEGER DEFAULT 0;
