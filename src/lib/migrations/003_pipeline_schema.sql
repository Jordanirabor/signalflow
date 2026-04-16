-- Automated Calendar Pipeline — Schema Extensions
-- Requirements: 1.3, 8.6, 9.4

-- ============================================================
-- EXTEND EXISTING TABLES
-- ============================================================

-- Add email, discovery source, and discovery timestamp to lead
ALTER TABLE lead ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE lead ADD COLUMN IF NOT EXISTS discovery_source VARCHAR(100);
ALTER TABLE lead ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;

-- Add Gmail thread/message IDs to outreach_record for reply matching
ALTER TABLE outreach_record ADD COLUMN IF NOT EXISTS gmail_thread_id VARCHAR(255);
ALTER TABLE outreach_record ADD COLUMN IF NOT EXISTS gmail_message_id VARCHAR(255);

-- ============================================================
-- PIPELINE_CONFIG
-- ============================================================
CREATE TABLE pipeline_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id            UUID NOT NULL REFERENCES founder(id) UNIQUE,
  run_interval_minutes  INTEGER NOT NULL DEFAULT 60,
  business_hours_start  VARCHAR(5) NOT NULL DEFAULT '09:00',
  business_hours_end    VARCHAR(5) NOT NULL DEFAULT '17:00',
  business_days         INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
  timezone              VARCHAR(100) NOT NULL DEFAULT 'America/New_York',
  daily_discovery_cap   INTEGER NOT NULL DEFAULT 50,
  min_lead_score        INTEGER NOT NULL DEFAULT 50,
  max_follow_ups        INTEGER NOT NULL DEFAULT 3,
  sequence_cadence_days INTEGER[] NOT NULL DEFAULT '{3,5,7}',
  tone_preference       VARCHAR(20) NOT NULL DEFAULT 'professional'
    CHECK (tone_preference IN ('professional', 'casual', 'direct')),
  product_context       TEXT NOT NULL DEFAULT '',
  value_proposition     TEXT NOT NULL DEFAULT '',
  target_pain_points    TEXT[] NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PIPELINE_RUN
-- ============================================================
CREATE TABLE pipeline_run (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id            UUID NOT NULL REFERENCES founder(id),
  status                VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  stages_completed      TEXT[] NOT NULL DEFAULT '{}',
  stage_errors          JSONB NOT NULL DEFAULT '{}',
  prospects_discovered  INTEGER NOT NULL DEFAULT 0,
  messages_sent         INTEGER NOT NULL DEFAULT 0,
  replies_processed     INTEGER NOT NULL DEFAULT 0,
  meetings_booked       INTEGER NOT NULL DEFAULT 0,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

-- ============================================================
-- EMAIL_CONNECTION
-- ============================================================
CREATE TABLE email_connection (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id       UUID NOT NULL REFERENCES founder(id) UNIQUE,
  email            VARCHAR(255) NOT NULL,
  provider         VARCHAR(20) NOT NULL DEFAULT 'gmail'
    CHECK (provider IN ('gmail')),
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  sending_name     VARCHAR(255) NOT NULL DEFAULT '',
  email_signature  TEXT NOT NULL DEFAULT '',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_sync_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CALENDAR_CONNECTION
-- ============================================================
CREATE TABLE calendar_connection (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id       UUID NOT NULL REFERENCES founder(id) UNIQUE,
  calendar_id      VARCHAR(255) NOT NULL,
  provider         VARCHAR(20) NOT NULL DEFAULT 'google'
    CHECK (provider IN ('google')),
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AVAILABILITY_WINDOW
-- ============================================================
CREATE TABLE availability_window (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id  UUID NOT NULL REFERENCES founder(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  VARCHAR(5) NOT NULL,
  end_time    VARCHAR(5) NOT NULL,
  timezone    VARCHAR(100) NOT NULL DEFAULT 'America/New_York',
  UNIQUE (founder_id, day_of_week)
);

-- ============================================================
-- INCOMING_REPLY
-- ============================================================
CREATE TABLE incoming_reply (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  founder_id                  UUID NOT NULL REFERENCES founder(id),
  lead_id                     UUID NOT NULL REFERENCES lead(id),
  outreach_record_id          UUID NOT NULL REFERENCES outreach_record(id),
  gmail_message_id            VARCHAR(255) NOT NULL,
  gmail_thread_id             VARCHAR(255) NOT NULL,
  from_email                  VARCHAR(255) NOT NULL,
  subject                     VARCHAR(500),
  body_text                   TEXT NOT NULL,
  received_at                 TIMESTAMPTZ NOT NULL,
  classification_result       VARCHAR(30),
  classification_confidence   FLOAT,
  classification_reasoning    TEXT,
  detected_return_date        TIMESTAMPTZ,
  requires_manual_review      BOOLEAN NOT NULL DEFAULT false,
  processed_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BOOKING_PROPOSAL
-- ============================================================
CREATE TABLE booking_proposal (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id           UUID NOT NULL REFERENCES lead(id),
  founder_id        UUID NOT NULL REFERENCES founder(id),
  proposed_slots    JSONB NOT NULL DEFAULT '[]',
  status            VARCHAR(20) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'declined', 'expired')),
  proposed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at      TIMESTAMPTZ,
  confirmed_slot    JSONB,
  follow_up_sent_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CALENDAR_EVENT
-- ============================================================
CREATE TABLE calendar_event (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  calendar_event_id VARCHAR(255) NOT NULL,
  founder_id        UUID NOT NULL REFERENCES founder(id),
  lead_id           UUID NOT NULL REFERENCES lead(id),
  title             VARCHAR(500) NOT NULL,
  description       TEXT,
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ NOT NULL,
  attendee_email    VARCHAR(255) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Reply matching: find replies by Gmail thread ID (Req 9.4)
CREATE INDEX idx_incoming_reply_gmail_thread_id
  ON incoming_reply (gmail_thread_id);

-- Recent pipeline runs per founder (Req 1.3)
CREATE INDEX idx_pipeline_run_founder_started
  ON pipeline_run (founder_id, started_at DESC);

-- Active booking proposals per lead
CREATE INDEX idx_booking_proposal_lead_status
  ON booking_proposal (lead_id, status);

-- Email-based lead lookups
CREATE INDEX idx_lead_email
  ON lead (email)
  WHERE email IS NOT NULL;

-- ============================================================
-- SEED DEFAULT AVAILABILITY WINDOWS (Mon–Fri 9:00–17:00)
-- ============================================================
INSERT INTO availability_window (founder_id, day_of_week, start_time, end_time, timezone)
VALUES
  ('00000000-0000-0000-0000-000000000001', 1, '09:00', '17:00', 'America/New_York'),
  ('00000000-0000-0000-0000-000000000001', 2, '09:00', '17:00', 'America/New_York'),
  ('00000000-0000-0000-0000-000000000001', 3, '09:00', '17:00', 'America/New_York'),
  ('00000000-0000-0000-0000-000000000001', 4, '09:00', '17:00', 'America/New_York'),
  ('00000000-0000-0000-0000-000000000001', 5, '09:00', '17:00', 'America/New_York')
ON CONFLICT (founder_id, day_of_week) DO NOTHING;
