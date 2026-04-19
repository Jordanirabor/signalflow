-- Migration: Add icp_profile_id column to pipeline_run
-- Links pipeline runs to a specific ICP profile for single-profile execution tracking.

ALTER TABLE pipeline_run ADD COLUMN icp_profile_id UUID REFERENCES icp_profile(id) ON DELETE SET NULL;
CREATE INDEX idx_pipeline_run_icp_profile ON pipeline_run(icp_profile_id);
