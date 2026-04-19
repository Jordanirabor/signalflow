/**
 * Email Transport Service — strategy router that abstracts over Gmail OAuth
 * and custom SMTP/IMAP providers.
 *
 * All callers (Pipeline Orchestrator, outreach API route) use the unified
 * `send()` and `checkInbox()` interfaces without knowledge of the underlying
 * provider.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { query } from '@/lib/db';
import { getEmailConnection, pollInbox, sendEmail } from '@/services/emailIntegrationService';
import { pollImapInbox } from '@/services/imapMonitorService';
import {
  createIncomingReplyRecord,
  matchIncomingMessage,
} from '@/services/messageThreadingService';
import { classifyReply } from '@/services/responseClassifierService';
import { sendViaSmtp, type SmtpConfig } from '@/services/smtpTransportService';
import type { IncomingReply } from '@/types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SendResult {
  messageId: string;
  threadId: string | null;
}

export interface InboxCheckResult {
  replies: IncomingReply[];
}

export interface SendOptions {
  founderId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
}

// ---------------------------------------------------------------------------
// Row types for database queries
// ---------------------------------------------------------------------------

interface EmailConnectionRow {
  active_provider: 'gmail' | 'smtp_imap';
}

interface ProviderConfigRow {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_encryption: 'tls' | 'starttls' | 'none';
  from_email: string;
  from_name: string;
  reply_to_email: string | null;
  smtp_verified: boolean;
  imap_verified: boolean;
}

// ---------------------------------------------------------------------------
// getActiveProvider
// ---------------------------------------------------------------------------

/**
 * Read the active email provider for a founder from `email_connection`.
 * Defaults to `'gmail'` when no connection row exists.
 */
export async function getActiveProvider(founderId: string): Promise<'gmail' | 'smtp_imap'> {
  const result = await query<EmailConnectionRow>(
    `SELECT active_provider FROM email_connection
     WHERE founder_id = $1 AND is_active = true`,
    [founderId],
  );

  if (result.rows.length === 0) {
    return 'gmail';
  }

  return result.rows[0].active_provider;
}

// ---------------------------------------------------------------------------
// getProviderConnectionStatus
// ---------------------------------------------------------------------------

/**
 * Return the current provider, connection status, email, and any error
 * for the given founder.
 */
export async function getProviderConnectionStatus(founderId: string): Promise<{
  provider: 'gmail' | 'smtp_imap';
  connected: boolean;
  email?: string;
  error?: string;
  sendingName?: string;
  emailSignature?: string;
}> {
  const provider = await getActiveProvider(founderId);

  // Fetch sending settings from email_connection (always, regardless of provider)
  const conn = await getEmailConnection(founderId);
  const sendingName = conn?.sendingName || undefined;
  const emailSignature = conn?.emailSignature || undefined;

  if (provider === 'gmail') {
    if (!conn) {
      return {
        provider,
        connected: false,
        error: 'No Gmail connection configured',
        sendingName,
        emailSignature,
      };
    }
    return {
      provider,
      connected: conn.isActive,
      email: conn.email,
      error: conn.isActive ? undefined : 'Gmail connection is inactive',
      sendingName,
      emailSignature,
    };
  }

  // smtp_imap provider
  const configResult = await query<ProviderConfigRow>(
    `SELECT smtp_host, smtp_port, smtp_username, smtp_password, smtp_encryption,
            from_email, from_name, reply_to_email, smtp_verified, imap_verified
     FROM email_provider_config
     WHERE founder_id = $1`,
    [founderId],
  );

  if (configResult.rows.length === 0) {
    return {
      provider,
      connected: false,
      error: 'No SMTP/IMAP configuration found',
      sendingName,
      emailSignature,
    };
  }

  const config = configResult.rows[0];
  const smtpOk = config.smtp_verified;
  const imapOk = config.imap_verified;

  if (!smtpOk && !imapOk) {
    return {
      provider,
      connected: false,
      email: config.from_email,
      error: 'Neither SMTP nor IMAP connections are verified',
      sendingName,
      emailSignature,
    };
  }

  if (!smtpOk) {
    return {
      provider,
      connected: false,
      email: config.from_email,
      error: 'SMTP connection is not verified',
      sendingName,
      emailSignature,
    };
  }

  if (!imapOk) {
    return {
      provider,
      connected: false,
      email: config.from_email,
      error: 'IMAP connection is not verified',
      sendingName,
      emailSignature,
    };
  }

  return { provider, connected: true, email: config.from_email, sendingName, emailSignature };
}

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

/**
 * Send an email through the active provider for the given founder.
 *
 * - Gmail: delegates to `sendEmail()` and normalizes the result.
 * - SMTP: loads config, delegates to `sendViaSmtp()`, persists `smtp_message_id`
 *   on the outreach_record, and normalizes the result.
 *
 * Requirements: 7.1, 7.3, 7.5
 */
export async function send(options: SendOptions): Promise<SendResult> {
  const { founderId, to, subject, body, inReplyTo, references } = options;
  const provider = await getActiveProvider(founderId);

  if (provider === 'gmail') {
    const result = await sendEmail(founderId, to, subject, body);
    return {
      messageId: result.gmailMessageId,
      threadId: result.gmailThreadId,
    };
  }

  // smtp_imap provider
  const configResult = await query<ProviderConfigRow>(
    `SELECT smtp_host, smtp_port, smtp_username, smtp_password, smtp_encryption,
            from_email, from_name, reply_to_email, smtp_verified, imap_verified
     FROM email_provider_config
     WHERE founder_id = $1`,
    [founderId],
  );

  if (configResult.rows.length === 0) {
    throw new Error('PROVIDER_NOT_CONFIGURED');
  }

  const row = configResult.rows[0];
  if (!row.smtp_verified) {
    throw new Error('PROVIDER_NOT_VERIFIED');
  }

  const smtpConfig: SmtpConfig = {
    host: row.smtp_host,
    port: row.smtp_port,
    username: row.smtp_username,
    encryptedPassword: row.smtp_password,
    encryption: row.smtp_encryption,
    fromEmail: row.from_email,
    fromName: row.from_name,
    replyToEmail: row.reply_to_email ?? undefined,
  };

  // Get the email connection for the founder's signature
  const conn = await getEmailConnection(founderId);
  const signature = conn?.emailSignature ?? '';

  const smtpResult = await sendViaSmtp({
    config: smtpConfig,
    to,
    subject,
    body,
    signature,
    inReplyTo,
    references,
  });

  // Persist smtp_message_id on the most recent outreach_record for this founder + recipient
  await query(
    `UPDATE outreach_record
     SET smtp_message_id = $1
     WHERE id = (
       SELECT id FROM outreach_record
       WHERE founder_id = $2
       ORDER BY created_at DESC
       LIMIT 1
     )`,
    [smtpResult.messageId, founderId],
  );

  return {
    messageId: smtpResult.messageId,
    threadId: null,
  };
}

// ---------------------------------------------------------------------------
// checkInbox
// ---------------------------------------------------------------------------

/**
 * Check for new replies through the active provider.
 *
 * - Gmail: delegates to `pollInbox()` which returns `IncomingReply[]` directly.
 * - SMTP/IMAP: delegates to `pollImapInbox()` which returns `ImapMessage[]`,
 *   then processes each through `matchIncomingMessage()` →
 *   `createIncomingReplyRecord()` → `classifyReply()` with CRM transitions.
 *
 * Requirements: 7.2, 7.4, 7.6
 */
export async function checkInbox(
  founderId: string,
  sinceTimestamp: Date,
): Promise<InboxCheckResult> {
  const provider = await getActiveProvider(founderId);

  if (provider === 'gmail') {
    const replies = await pollInbox(founderId, sinceTimestamp);
    return { replies };
  }

  // smtp_imap provider — poll IMAP and process each message
  const imapMessages = await pollImapInbox(founderId);
  const replies: IncomingReply[] = [];

  for (const msg of imapMessages) {
    // Attempt to match the incoming message to an outreach record
    const match = await matchIncomingMessage(founderId, msg.inReplyTo, msg.references, msg.from);

    if (!match) {
      // Unmatched messages are logged by matchIncomingMessage; skip processing
      continue;
    }

    // Persist the incoming reply record with IMAP-specific fields
    const reply = await createIncomingReplyRecord(founderId, match, msg);
    replies.push(reply);

    // Classify the reply and let the classifier handle storage + manual review flagging
    try {
      await classifyReply(reply.id, reply.bodyText);
    } catch (err) {
      console.error(
        `[EmailTransport] Failed to classify reply ${reply.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  return { replies };
}
