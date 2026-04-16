-- SignalFlow GTM Intelligence Engine — Initial Schema
-- Requirements: 10.1, 10.4, 10.5

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- FOUNDER
-- ============================================================
CREATE TABLE founder (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       VARCHAR(255) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  product_context TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ICP (Ideal Customer Profile)
-- ============================================================
CREATE TABLE icp (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id    UUID NOT NULL REFERENCES founder(id),
  target_role   VARCHAR(255) NOT NULL,
  industry      VARCHAR(255) NOT NULL,
  company_stage VARCHAR(255),
  geography     VARCHAR(255),
  custom_tags   TEXT[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LEAD
-- ============================================================
CREATE TABLE lead (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id        UUID NOT NULL REFERENCES founder(id),
  name              VARCHAR(255) NOT NULL,
  role              VARCHAR(255) NOT NULL,
  company           VARCHAR(255) NOT NULL,
  industry          VARCHAR(255),
  geography         VARCHAR(255),
  lead_score        INTEGER NOT NULL DEFAULT 0,
  score_breakdown   JSONB NOT NULL DEFAULT '{}',
  enrichment_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending', 'complete', 'partial')),
  enrichment_data   JSONB,
  crm_status        VARCHAR(20) NOT NULL DEFAULT 'New'
    CHECK (crm_status IN ('New', 'Contacted', 'Replied', 'Booked', 'Closed')),
  is_deleted        BOOLEAN NOT NULL DEFAULT false,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- OUTREACH_RECORD
-- ============================================================
CREATE TABLE outreach_record (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id         UUID NOT NULL REFERENCES lead(id),
  founder_id      UUID NOT NULL REFERENCES founder(id),
  channel         VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'dm')),
  message_content TEXT NOT NULL,
  outreach_date   TIMESTAMPTZ NOT NULL,
  is_follow_up    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STATUS_CHANGE
-- ============================================================
CREATE TABLE status_change (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID NOT NULL REFERENCES lead(id),
  from_status VARCHAR(20) NOT NULL,
  to_status   VARCHAR(20) NOT NULL,
  reason      TEXT,
  meeting_date TIMESTAMPTZ,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CALL_NOTE
-- ============================================================
CREATE TABLE call_note (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id               UUID NOT NULL REFERENCES lead(id),
  founder_id            UUID NOT NULL REFERENCES founder(id),
  pain_points           TEXT[],
  objections            TEXT[],
  feature_requests      TEXT[],
  next_steps            TEXT,
  sentiment             VARCHAR(10) CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  sentiment_inferred    BOOLEAN NOT NULL DEFAULT false,
  raw_text              TEXT NOT NULL,
  tag_generation_failed BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TAG
-- ============================================================
CREATE TABLE tag (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_note_id UUID NOT NULL REFERENCES call_note(id),
  category     VARCHAR(20) NOT NULL
    CHECK (category IN ('pain_point', 'objection', 'feature_request')),
  value        VARCHAR(255) NOT NULL
);

-- ============================================================
-- THROTTLE_CONFIG
-- ============================================================
CREATE TABLE throttle_config (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id  UUID NOT NULL REFERENCES founder(id) UNIQUE,
  email_limit INTEGER NOT NULL DEFAULT 20,
  dm_limit    INTEGER NOT NULL DEFAULT 20,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Duplicate prevention: unique on (founder_id, lower(name), lower(company)) for non-deleted leads (Req 10.4)
CREATE UNIQUE INDEX idx_lead_unique_name_company
  ON lead (founder_id, LOWER(name), LOWER(company))
  WHERE is_deleted = false;

-- Lead listing sorted by score (Req 3.2)
CREATE INDEX idx_lead_score
  ON lead (lead_score DESC)
  WHERE is_deleted = false;

-- Pipeline views by CRM status
CREATE INDEX idx_lead_crm_status
  ON lead (crm_status)
  WHERE is_deleted = false;

-- Chronological queries
CREATE INDEX idx_lead_created_at
  ON lead (created_at);

-- Child table lookups by lead_id
CREATE INDEX idx_outreach_lead_id      ON outreach_record (lead_id);
CREATE INDEX idx_status_change_lead_id ON status_change (lead_id);
CREATE INDEX idx_call_note_lead_id     ON call_note (lead_id);
CREATE INDEX idx_tag_call_note_id      ON tag (call_note_id);
