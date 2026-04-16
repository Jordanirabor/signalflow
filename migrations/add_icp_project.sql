-- Migration: Add icp_project table and project_id columns
-- This migration creates the icp_project table and adds project_id foreign keys
-- to icp_profile, lead, and pipeline_run tables.

-- New table: icp_project
CREATE TABLE icp_project (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id UUID NOT NULL REFERENCES founder(id),
  name VARCHAR(100) NOT NULL,
  product_description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(founder_id, name)
);

CREATE INDEX idx_icp_project_founder ON icp_project(founder_id) WHERE is_deleted = false;

-- Add project_id to icp_profile
ALTER TABLE icp_profile ADD COLUMN project_id UUID REFERENCES icp_project(id) ON DELETE SET NULL;
CREATE INDEX idx_icp_profile_project ON icp_profile(project_id);

-- Add project_id to lead
ALTER TABLE lead ADD COLUMN project_id UUID REFERENCES icp_project(id) ON DELETE SET NULL;
CREATE INDEX idx_lead_project ON lead(project_id) WHERE is_deleted = false;

-- Add project_id to pipeline_run
ALTER TABLE pipeline_run ADD COLUMN project_id UUID REFERENCES icp_project(id);
