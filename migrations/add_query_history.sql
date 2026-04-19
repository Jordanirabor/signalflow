-- Migration: Add query_history table and company_resolved_via column
-- Creates the query_history table for tracking used search queries per ICP profile,
-- and adds the company_resolved_via column to the lead table for research agent tracking.

-- New table: query_history
-- Stores executed search queries per ICP profile for deduplication across runs
CREATE TABLE IF NOT EXISTS query_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  icp_profile_id UUID NOT NULL REFERENCES icp_profile(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  vector TEXT NOT NULL,
  executed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Fast lookup for deduplication: find recent queries for an ICP profile
CREATE INDEX idx_query_history_profile_executed
  ON query_history (icp_profile_id, executed_at DESC);

-- Prevent exact duplicate inserts within the same run
CREATE UNIQUE INDEX idx_query_history_profile_query
  ON query_history (icp_profile_id, query_text);

-- Track how a lead's company was resolved (NULL = had company, 'research_agent', 'manual')
ALTER TABLE lead ADD COLUMN IF NOT EXISTS company_resolved_via TEXT;
