-- ============================================================
-- 004: Clean up bad lead data and backfill emails
-- ============================================================
-- Fixes two issues:
-- 1. Leads where name = company (maps scraper artifact)
-- 2. Leads with no real person name (company names, single words)
-- 3. Backfills lead.email from enrichment_data->>'email'
-- ============================================================

-- Step 1: Soft-delete leads where name equals company (maps scraper junk)
UPDATE lead
SET is_deleted = true,
    deleted_at = NOW(),
    updated_at = NOW()
WHERE is_deleted = false
  AND LOWER(TRIM(name)) = LOWER(TRIM(company));

-- Step 2: Soft-delete leads with no real person name
-- (name that looks like a company: contains Inc, LLC, Ltd, Corp, etc.)
UPDATE lead
SET is_deleted = true,
    deleted_at = NOW(),
    updated_at = NOW()
WHERE is_deleted = false
  AND (
    name ~* '\m(inc\.?|llc|ltd\.?|corp\.?|gmbh|plc|limited)\M'
    OR name ~* '\m(technologies|solutions|software|consulting|global|group|services|design|systems|headquarters|partners)\M'
  );

-- Step 3: Soft-delete leads with single-word names (no last name)
UPDATE lead
SET is_deleted = true,
    deleted_at = NOW(),
    updated_at = NOW()
WHERE is_deleted = false
  AND TRIM(name) NOT LIKE '% %';

-- Step 4: Backfill lead.email from enrichment_data for existing leads
UPDATE lead
SET email = enrichment_data->>'email',
    updated_at = NOW()
WHERE email IS NULL
  AND enrichment_data->>'email' IS NOT NULL
  AND enrichment_data->>'email' != '';
