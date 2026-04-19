-- Migration: Add email provider configuration tables and schema changes
-- This migration creates the email_provider_config and imap_polling_state tables,
-- and extends email_connection, outreach_record, and incoming_reply for SMTP/IMAP support.

-- New table: email_provider_config
-- Stores SMTP/IMAP provider configuration per founder
CREATE TABLE email_provider_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    founder_id UUID NOT NULL UNIQUE,
    provider_type VARCHAR(20) NOT NULL CHECK (provider_type IN ('smtp_imap')),

    -- SMTP settings
    smtp_host VARCHAR(255) NOT NULL,
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_username VARCHAR(255) NOT NULL,
    smtp_password TEXT NOT NULL,               -- AES-256-GCM encrypted
    smtp_encryption VARCHAR(20) NOT NULL DEFAULT 'tls' CHECK (smtp_encryption IN ('tls', 'starttls', 'none')),
    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(255) NOT NULL DEFAULT '',
    reply_to_email VARCHAR(255),

    -- IMAP settings
    imap_host VARCHAR(255) NOT NULL,
    imap_port INTEGER NOT NULL DEFAULT 993,
    imap_username VARCHAR(255) NOT NULL,
    imap_password TEXT NOT NULL,               -- AES-256-GCM encrypted
    imap_encryption VARCHAR(20) NOT NULL DEFAULT 'tls' CHECK (imap_encryption IN ('tls', 'starttls', 'none')),
    watched_folders TEXT[] NOT NULL DEFAULT ARRAY['INBOX'],
    poll_interval_minutes INTEGER NOT NULL DEFAULT 5 CHECK (poll_interval_minutes BETWEEN 1 AND 60),

    -- Connection status
    smtp_verified BOOLEAN NOT NULL DEFAULT false,
    imap_verified BOOLEAN NOT NULL DEFAULT false,
    imap_consecutive_failures INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- New table: imap_polling_state
-- Tracks IMAP polling state per folder per founder
CREATE TABLE imap_polling_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    founder_id UUID NOT NULL,
    folder_name VARCHAR(255) NOT NULL DEFAULT 'INBOX',
    last_seen_uid INTEGER NOT NULL DEFAULT 0,
    last_poll_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(founder_id, folder_name)
);

CREATE INDEX idx_imap_polling_state_founder ON imap_polling_state(founder_id);

-- Extend email_connection to support provider switching
ALTER TABLE email_connection
    ALTER COLUMN provider TYPE VARCHAR(20);

-- Update provider check constraint to allow smtp_imap
ALTER TABLE email_connection
    DROP CONSTRAINT IF EXISTS email_connection_provider_check;
ALTER TABLE email_connection
    ADD CONSTRAINT email_connection_provider_check CHECK (provider IN ('gmail', 'smtp_imap'));

ALTER TABLE email_connection
    ADD COLUMN active_provider VARCHAR(20) NOT NULL DEFAULT 'gmail'
    CHECK (active_provider IN ('gmail', 'smtp_imap'));

-- Add SMTP message ID to outreach_record for threading
ALTER TABLE outreach_record
    ADD COLUMN smtp_message_id VARCHAR(512);

CREATE INDEX idx_outreach_record_smtp_message_id ON outreach_record(smtp_message_id);

-- Add IMAP-specific fields to incoming_reply
ALTER TABLE incoming_reply
    ADD COLUMN imap_uid INTEGER,
    ADD COLUMN raw_headers JSONB,
    ADD COLUMN message_id VARCHAR(512),          -- RFC 2822 Message-ID
    ADD COLUMN in_reply_to VARCHAR(512),         -- In-Reply-To header
    ADD COLUMN references_header TEXT[];          -- References header values

-- Allow gmail_message_id and gmail_thread_id to be NULL for IMAP replies
ALTER TABLE incoming_reply
    ALTER COLUMN gmail_message_id DROP NOT NULL,
    ALTER COLUMN gmail_thread_id DROP NOT NULL;

CREATE INDEX idx_incoming_reply_message_id ON incoming_reply(message_id);
CREATE INDEX idx_incoming_reply_imap_uid ON incoming_reply(imap_uid);
