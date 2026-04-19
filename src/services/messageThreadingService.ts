/**
 * Message Threading Service — matches incoming IMAP messages to outreach records
 * and persists incoming reply records.
 *
 * Uses a 3-tier matching strategy delegated to pure functions in threadingUtils:
 * 1. In-Reply-To header → known outreach Message-IDs
 * 2. References header → known outreach Message-IDs
 * 3. Sender email → lead emails with active outreach records
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { query } from '@/lib/db';
import {
  matchByEmail,
  matchByInReplyTo,
  matchByReferences,
  type ThreadMatch,
} from '@/lib/threadingUtils';
import type { ImapMessage } from '@/services/imapMonitorService';
import type { IncomingReply } from '@/types';

// ---------------------------------------------------------------------------
// Row types for database queries
// ---------------------------------------------------------------------------

interface OutreachMessageIdRow {
  id: string;
  lead_id: string;
  smtp_message_id: string | null;
  gmail_message_id: string | null;
}

interface LeadEmailRow {
  email: string;
  outreach_record_id: string;
  lead_id: string;
}

interface IncomingReplyRow {
  id: string;
  founder_id: string;
  lead_id: string;
  outreach_record_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  from_email: string;
  subject: string;
  body_text: string;
  received_at: Date;
  classification_result: string | null;
  classification_confidence: number | null;
  requires_manual_review: boolean;
  processed_at: Date | null;
  imap_uid: number | null;
  raw_headers: Record<string, string> | null;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string[] | null;
}

// ---------------------------------------------------------------------------
// Row → domain mapping
// ---------------------------------------------------------------------------

function mapIncomingReplyRow(row: IncomingReplyRow): IncomingReply {
  return {
    id: row.id,
    founderId: row.founder_id,
    leadId: row.lead_id,
    outreachRecordId: row.outreach_record_id,
    gmailMessageId: row.gmail_message_id,
    gmailThreadId: row.gmail_thread_id,
    fromEmail: row.from_email,
    subject: row.subject,
    bodyText: row.body_text,
    receivedAt: row.received_at,
    classificationResult: row.classification_result ?? undefined,
    classificationConfidence: row.classification_confidence ?? undefined,
    requiresManualReview: row.requires_manual_review,
    processedAt: row.processed_at ?? undefined,
    imapUid: row.imap_uid ?? undefined,
    rawHeaders: row.raw_headers ?? undefined,
    messageId: row.message_id ?? undefined,
    inReplyTo: row.in_reply_to ?? undefined,
    referencesHeader: row.references_header ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// matchIncomingMessage
// ---------------------------------------------------------------------------

/**
 * Attempt to match an incoming message to an outreach record for the given
 * founder using the 3-tier strategy:
 *   1. In-Reply-To header → known outreach Message-IDs
 *   2. References header  → known outreach Message-IDs
 *   3. Sender email       → lead emails with active outreach records
 *
 * Returns null and logs a warning when no match is found.
 */
export async function matchIncomingMessage(
  founderId: string,
  inReplyTo: string | null,
  references: string[],
  fromEmail: string,
): Promise<ThreadMatch | null> {
  // 1. Build knownMessageIds map from outreach_record
  const outreachResult = await query<OutreachMessageIdRow>(
    `SELECT id, lead_id, smtp_message_id, gmail_message_id
     FROM outreach_record
     WHERE founder_id = $1
       AND (smtp_message_id IS NOT NULL OR gmail_message_id IS NOT NULL)`,
    [founderId],
  );

  const knownMessageIds = new Map<string, { outreachRecordId: string; leadId: string }>();
  for (const row of outreachResult.rows) {
    const entry = { outreachRecordId: row.id, leadId: row.lead_id };
    if (row.smtp_message_id) {
      knownMessageIds.set(row.smtp_message_id, entry);
    }
    if (row.gmail_message_id) {
      knownMessageIds.set(row.gmail_message_id, entry);
    }
  }

  // 2. Build leadEmails map from lead + outreach_record
  const leadResult = await query<LeadEmailRow>(
    `SELECT l.email, or2.id as outreach_record_id, l.id as lead_id
     FROM lead l
     JOIN outreach_record or2 ON l.id = or2.lead_id
     WHERE l.founder_id = $1
       AND l.email IS NOT NULL
       AND l.is_deleted = false`,
    [founderId],
  );

  const leadEmails = new Map<string, { outreachRecordId: string; leadId: string }>();
  for (const row of leadResult.rows) {
    leadEmails.set(row.email, {
      outreachRecordId: row.outreach_record_id,
      leadId: row.lead_id,
    });
  }

  // 3. Try matching in priority order
  const match =
    matchByInReplyTo(inReplyTo, knownMessageIds) ??
    matchByReferences(references, knownMessageIds) ??
    matchByEmail(fromEmail, leadEmails);

  if (!match) {
    console.warn(
      `[MessageThreading] Unmatched incoming message — from: ${fromEmail}, messageId: ${inReplyTo ?? 'none'}, founderId: ${founderId}`,
    );
  }

  return match;
}

// ---------------------------------------------------------------------------
// createIncomingReplyRecord
// ---------------------------------------------------------------------------

/**
 * Persist an incoming IMAP reply with all IMAP-specific fields.
 */
export async function createIncomingReplyRecord(
  founderId: string,
  match: ThreadMatch,
  imapMessage: ImapMessage,
): Promise<IncomingReply> {
  const result = await query<IncomingReplyRow>(
    `INSERT INTO incoming_reply (
       founder_id, lead_id, outreach_record_id,
       from_email, subject, body_text, received_at,
       imap_uid, raw_headers, message_id, in_reply_to, references_header
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      founderId,
      match.leadId,
      match.outreachRecordId,
      imapMessage.from,
      imapMessage.subject,
      imapMessage.bodyText,
      imapMessage.date,
      imapMessage.uid,
      JSON.stringify(imapMessage.rawHeaders),
      imapMessage.messageId,
      imapMessage.inReplyTo,
      JSON.stringify(imapMessage.references),
    ],
  );

  return mapIncomingReplyRow(result.rows[0]);
}

// Re-export ThreadMatch for consumers
export type { ThreadMatch };
