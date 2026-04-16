-- Link founders to ConsentKeys OIDC users
-- Adds oidc_sub column for mapping OIDC subject to founder record

ALTER TABLE founder ADD COLUMN IF NOT EXISTS oidc_sub VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_founder_oidc_sub ON founder (oidc_sub) WHERE oidc_sub IS NOT NULL;

-- Backfill the seeded founder with a placeholder (will be overwritten on first login)
-- No-op if already set
UPDATE founder SET oidc_sub = 'seed-placeholder' WHERE id = '00000000-0000-0000-0000-000000000001' AND oidc_sub IS NULL;
