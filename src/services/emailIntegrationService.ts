import { query } from '@/lib/db';
import type { EmailConnection, IncomingReply } from '@/types';
import crypto from 'crypto';
import { google } from 'googleapis';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? '';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

// ---------------------------------------------------------------------------
// OAuth 2.0 helpers
// ---------------------------------------------------------------------------

function getOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/**
 * Generate the Gmail OAuth authorization URL.
 */
export function getAuthorizeUrl(state?: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state,
  });
}

/**
 * Exchange an authorization code for tokens and persist the connection.
 */
export async function handleOAuthCallback(
  founderId: string,
  code: string,
): Promise<EmailConnection> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  client.setCredentials(tokens);

  // Fetch the user's email address
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  const email = data.email ?? '';

  const accessToken = encrypt(tokens.access_token ?? '');
  const refreshToken = encrypt(tokens.refresh_token ?? '');
  const tokenExpiresAt = new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000);

  // Upsert email connection
  const result = await query<EmailConnectionRow>(
    `INSERT INTO email_connection (founder_id, email, provider, access_token, refresh_token, token_expires_at, is_active)
     VALUES ($1, $2, 'gmail', $3, $4, $5, true)
     ON CONFLICT (founder_id) DO UPDATE SET
       email = EXCLUDED.email,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       is_active = true
     RETURNING ${EMAIL_CONNECTION_COLUMNS}`,
    [founderId, email, accessToken, refreshToken, tokenExpiresAt],
  );

  const connection = mapEmailConnectionRow(result.rows[0]);

  // Verify connection by sending test message to founder's own address
  await sendTestEmail(connection);

  return connection;
}

// ---------------------------------------------------------------------------
// AES-256-GCM Encryption / Decryption
// ---------------------------------------------------------------------------

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKeyBuffer(): Buffer {
  // Expect a 64-char hex string (32 bytes)
  return Buffer.from(ENCRYPTION_KEY, 'hex');
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKeyBuffer();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(encryptedStr: string): string {
  const key = getEncryptionKeyBuffer();
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// ---------------------------------------------------------------------------
// DB row types and mapping
// ---------------------------------------------------------------------------

interface EmailConnectionRow {
  id: string;
  founder_id: string;
  email: string;
  provider: 'gmail' | 'smtp_imap';
  active_provider: 'gmail' | 'smtp_imap';
  access_token: string;
  refresh_token: string;
  token_expires_at: Date;
  sending_name: string;
  email_signature: string;
  is_active: boolean;
  last_sync_at: Date | null;
  created_at: Date;
}

const EMAIL_CONNECTION_COLUMNS = `id, founder_id, email, provider, active_provider, access_token, refresh_token, token_expires_at, sending_name, email_signature, is_active, last_sync_at, created_at`;

function mapEmailConnectionRow(row: EmailConnectionRow): EmailConnection {
  return {
    id: row.id,
    founderId: row.founder_id,
    email: row.email,
    provider: row.provider,
    activeProvider: row.active_provider ?? 'gmail',
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    sendingName: row.sending_name,
    emailSignature: row.email_signature,
    isActive: row.is_active,
    lastSyncAt: row.last_sync_at ?? undefined,
    createdAt: row.created_at,
  };
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
}

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
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get an authenticated OAuth2 client for a founder, refreshing the token
 * automatically if it's within 5 minutes of expiry.
 */
async function getAuthenticatedClient(
  connection: EmailConnection,
): Promise<InstanceType<typeof google.auth.OAuth2>> {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: decrypt(connection.accessToken),
    refresh_token: decrypt(connection.refreshToken),
    expiry_date: connection.tokenExpiresAt.getTime(),
  });

  const now = Date.now();
  const expiresAt = connection.tokenExpiresAt.getTime();

  if (expiresAt - now < TOKEN_REFRESH_BUFFER_MS) {
    try {
      const { credentials } = await client.refreshAccessToken();
      const newAccessToken = encrypt(credentials.access_token ?? '');
      const newExpiresAt = new Date(credentials.expiry_date ?? now + 3600 * 1000);

      await query(
        `UPDATE email_connection SET access_token = $1, token_expires_at = $2 WHERE id = $3`,
        [newAccessToken, newExpiresAt, connection.id],
      );

      client.setCredentials(credentials);
    } catch {
      // Token refresh failed — likely revoked. Deactivate connection.
      await deactivateConnection(connection.id);
      throw new Error('EMAIL_TOKEN_EXPIRED');
    }
  }

  return client;
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

/**
 * Get the active email connection for a founder.
 */
export async function getEmailConnection(founderId: string): Promise<EmailConnection | null> {
  const result = await query<EmailConnectionRow>(
    `SELECT ${EMAIL_CONNECTION_COLUMNS} FROM email_connection WHERE founder_id = $1`,
    [founderId],
  );
  if (result.rows.length === 0) return null;
  return mapEmailConnectionRow(result.rows[0]);
}

/**
 * Check if a founder has an active email connection.
 */
export async function getConnectionStatus(founderId: string): Promise<{
  connected: boolean;
  email?: string;
  isActive?: boolean;
  lastSyncAt?: Date;
  sendingName?: string;
  emailSignature?: string;
}> {
  const conn = await getEmailConnection(founderId);
  if (!conn) return { connected: false };
  return {
    connected: true,
    email: conn.email,
    isActive: conn.isActive,
    lastSyncAt: conn.lastSyncAt,
    sendingName: conn.sendingName,
    emailSignature: conn.emailSignature,
  };
}

/**
 * Update the sending name and email signature for a founder's email connection.
 *
 * Requirements: 9.6
 */
export async function updateEmailSettings(
  founderId: string,
  sendingName: string,
  emailSignature: string,
): Promise<void> {
  // Try to update existing row first
  const result = await query(
    `UPDATE email_connection SET sending_name = $2, email_signature = $3 WHERE founder_id = $1`,
    [founderId, sendingName, emailSignature],
  );

  // If no row exists yet (no email provider connected), create a minimal one
  // so sending settings can still be saved and used for message generation
  if (result.rowCount === 0) {
    await query(
      `INSERT INTO email_connection (founder_id, email, provider, active_provider, access_token, refresh_token, token_expires_at, sending_name, email_signature, is_active)
       VALUES ($1, '', 'none', 'none', '', '', NOW(), $2, $3, false)
       ON CONFLICT (founder_id) DO UPDATE SET sending_name = $2, email_signature = $3`,
      [founderId, sendingName, emailSignature],
    );
  }
}

/**
 * Deactivate an email connection (e.g. on token revocation).
 */
export async function deactivateConnection(connectionId: string): Promise<void> {
  await query(`UPDATE email_connection SET is_active = false WHERE id = $1`, [connectionId]);
}

/**
 * Disconnect (delete) the email connection for a founder.
 */
export async function disconnectEmail(founderId: string): Promise<void> {
  await query(`DELETE FROM email_connection WHERE founder_id = $1`, [founderId]);
}

// ---------------------------------------------------------------------------
// Email signature helper
// ---------------------------------------------------------------------------

/**
 * Append the configured email signature to a message body.
 * If the signature is empty, returns the body unchanged.
 */
export function appendSignature(body: string, signature: string): string {
  if (!signature) return body;
  return `${body}\n\n${signature}`;
}

// ---------------------------------------------------------------------------
// Send email via Gmail API
// ---------------------------------------------------------------------------

/**
 * Send an email via Gmail API. Appends the founder's email signature.
 * Returns the gmail_thread_id and gmail_message_id.
 *
 * Requirements: 9.3, 9.6
 */
export async function sendEmail(
  founderId: string,
  to: string,
  subject: string,
  body: string,
): Promise<{ gmailThreadId: string; gmailMessageId: string }> {
  const connection = await getEmailConnection(founderId);
  if (!connection || !connection.isActive) {
    throw new Error('EMAIL_NOT_CONNECTED');
  }

  const client = await getAuthenticatedClient(connection);
  const gmail = google.gmail({ version: 'v1', auth: client });

  const fullBody = appendSignature(body, connection.emailSignature);

  const fromHeader = connection.sendingName
    ? `${connection.sendingName} <${connection.email}>`
    : connection.email;

  const rawMessage = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    fullBody,
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawMessage).toString('base64url');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });

  const gmailMessageId = response.data.id ?? '';
  const gmailThreadId = response.data.threadId ?? '';

  // Update last sync timestamp
  await query(`UPDATE email_connection SET last_sync_at = NOW() WHERE id = $1`, [connection.id]);

  return { gmailThreadId, gmailMessageId };
}

// ---------------------------------------------------------------------------
// Send test email (connection verification)
// ---------------------------------------------------------------------------

/**
 * Verify the email connection by sending a test message to the founder's own address.
 * Requirement: 9.2
 */
async function sendTestEmail(connection: EmailConnection): Promise<void> {
  const client = await getAuthenticatedClient(connection);
  const gmail = google.gmail({ version: 'v1', auth: client });

  const rawMessage = [
    `From: ${connection.email}`,
    `To: ${connection.email}`,
    `Subject: SignalFlow Email Connection Verified`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Your Gmail account has been successfully connected to SignalFlow. Automated outreach is now enabled.',
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawMessage).toString('base64url');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });
}

// ---------------------------------------------------------------------------
// Poll inbox for replies
// ---------------------------------------------------------------------------

/**
 * Poll the founder's Gmail inbox for new replies matching outreach thread IDs.
 * Returns IncomingReply records for each matched reply.
 *
 * Requirements: 9.4
 */
export async function pollInbox(founderId: string, sinceTimestamp: Date): Promise<IncomingReply[]> {
  const connection = await getEmailConnection(founderId);
  if (!connection || !connection.isActive) {
    throw new Error('EMAIL_NOT_CONNECTED');
  }

  const client = await getAuthenticatedClient(connection);
  const gmail = google.gmail({ version: 'v1', auth: client });

  // Get all outreach thread IDs for this founder
  const outreachResult = await query<{
    id: string;
    lead_id: string;
    gmail_thread_id: string;
  }>(
    `SELECT id, lead_id, gmail_thread_id FROM outreach_record
     WHERE founder_id = $1 AND gmail_thread_id IS NOT NULL`,
    [founderId],
  );

  if (outreachResult.rows.length === 0) return [];

  const threadMap = new Map<string, { outreachRecordId: string; leadId: string }>();
  for (const row of outreachResult.rows) {
    threadMap.set(row.gmail_thread_id, {
      outreachRecordId: row.id,
      leadId: row.lead_id,
    });
  }

  // Query Gmail for messages received after sinceTimestamp
  const afterEpoch = Math.floor(sinceTimestamp.getTime() / 1000);
  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    q: `after:${afterEpoch} in:inbox`,
    maxResults: 100,
  });

  const messages = listResponse.data.messages ?? [];
  if (messages.length === 0) return [];

  const replies: IncomingReply[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;

    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });

    const threadId = detail.data.threadId ?? '';
    const outreachMatch = threadMap.get(threadId);
    if (!outreachMatch) continue; // Not a reply to our outreach

    // Check if we already stored this reply
    const existing = await query(`SELECT id FROM incoming_reply WHERE gmail_message_id = $1`, [
      msg.id,
    ]);
    if (existing.rows.length > 0) continue;

    const headers = detail.data.payload?.headers ?? [];
    const fromHeader = headers.find((h) => h.name?.toLowerCase() === 'from')?.value ?? '';
    const subjectHeader = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '';

    // Skip messages sent by the founder themselves
    if (fromHeader.includes(connection.email)) continue;

    const bodyText = extractPlainTextBody(detail.data.payload);
    const internalDate = detail.data.internalDate
      ? new Date(parseInt(detail.data.internalDate, 10))
      : new Date();

    // Store the reply
    const insertResult = await query<IncomingReplyRow>(
      `INSERT INTO incoming_reply (founder_id, lead_id, outreach_record_id, gmail_message_id, gmail_thread_id, from_email, subject, body_text, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        founderId,
        outreachMatch.leadId,
        outreachMatch.outreachRecordId,
        msg.id,
        threadId,
        fromHeader,
        subjectHeader,
        bodyText,
        internalDate,
      ],
    );

    replies.push(mapIncomingReplyRow(insertResult.rows[0]));
  }

  // Update last sync timestamp
  await query(`UPDATE email_connection SET last_sync_at = NOW() WHERE id = $1`, [connection.id]);

  return replies;
}

/**
 * Match incoming inbox messages to outreach records by gmail_thread_id.
 * Returns only messages whose thread ID matches an outreach record.
 * Unmatched messages are ignored.
 *
 * This is a pure function used for thread matching logic.
 * Requirement: 9.4 (Property 14)
 */
export function matchRepliesToOutreach(
  inboxMessages: Array<{ messageId: string; threadId: string }>,
  outreachRecords: Array<{ outreachRecordId: string; gmailThreadId: string }>,
): Array<{ messageId: string; threadId: string; outreachRecordId: string }> {
  const outreachMap = new Map<string, string>();
  for (const record of outreachRecords) {
    outreachMap.set(record.gmailThreadId, record.outreachRecordId);
  }

  const matched: Array<{ messageId: string; threadId: string; outreachRecordId: string }> = [];
  for (const msg of inboxMessages) {
    const outreachRecordId = outreachMap.get(msg.threadId);
    if (outreachRecordId) {
      matched.push({ messageId: msg.messageId, threadId: msg.threadId, outreachRecordId });
    }
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Gmail body extraction helper
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractPlainTextBody(payload: any): string {
  if (!payload) return '';

  // Direct plain text body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }

  // Multipart — recurse into parts
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainTextBody(part);
      if (text) return text;
    }
  }

  return '';
}
/* eslint-enable @typescript-eslint/no-explicit-any */
