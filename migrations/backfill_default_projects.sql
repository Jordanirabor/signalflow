-- Migration: Backfill default projects for existing founders
-- This migration is idempotent and safe to run multiple times.
--
-- For each founder who has existing ICP profiles, it:
--   1. Creates a "Default Project" in icp_project
--   2. Copies product_context from pipeline_config as the product description
--   3. Backfills project_id on icp_profile, lead, and pipeline_run rows

-- Step 1: Create a "Default Project" for each founder who has existing ICP profiles.
-- Uses INSERT ... ON CONFLICT DO NOTHING on the (founder_id, name) unique constraint
-- so re-running this migration will not create duplicate projects.
INSERT INTO icp_project (founder_id, name, product_description)
SELECT DISTINCT
  ip.founder_id,
  'Default Project',
  COALESCE(pc.product_context, 'No product description available')
FROM icp_profile ip
LEFT JOIN pipeline_config pc ON pc.founder_id = ip.founder_id
ON CONFLICT (founder_id, name) DO NOTHING;

-- Step 2: Backfill project_id on icp_profile rows that have no project assigned.
UPDATE icp_profile
SET project_id = proj.id
FROM icp_project proj
WHERE icp_profile.founder_id = proj.founder_id
  AND proj.name = 'Default Project'
  AND icp_profile.project_id IS NULL;

-- Step 3: Backfill project_id on lead rows that have no project assigned.
UPDATE lead
SET project_id = proj.id
FROM icp_project proj
WHERE lead.founder_id = proj.founder_id
  AND proj.name = 'Default Project'
  AND lead.project_id IS NULL;

-- Step 4: Backfill project_id on pipeline_run rows that have no project assigned.
UPDATE pipeline_run
SET project_id = proj.id
FROM icp_project proj
WHERE pipeline_run.founder_id = proj.founder_id
  AND proj.name = 'Default Project'
  AND pipeline_run.project_id IS NULL;
