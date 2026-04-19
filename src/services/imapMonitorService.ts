/**
 * IMAP Monitor Service — polls IMAP inboxes for new messages using imapflow.
 *
 * Handles connection lifecycle, UID-based incremental fetching, consecutive
 * failure tracking with auto-deactivation, and plain-text body extraction.
 */

import { query } from '@/lib/db';
import {
  computeLastSeenUid,
  extractPlainTextFromMime,
  shouldDeactivateConnection,
} from '@/lib/imapUtils';
import { decrypt } from '@/services/emailIntegrationService';
import { ImapFlow } from 'imapflow';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ImapConfig {
  host: string;
  port: number;
  username: string;
  encryptedPassword: string;
  encryption: 'tls' | 'starttls' | 'none';
  watchedFolders: string[];
  pollIntervalMinutes: number;
}

export interface ImapMessage {
  uid: number;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  from: string;
  subject: string;
  date: Date;
  bodyText: string;
  rawHeaders: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildImapFlowOptions(config: ImapConfig, password: string) {
  const base: ConstructorParameters<typeof ImapFlow>[0] = {
    host: config.host,
    port: config.port,
    auth: { user: config.username, pass: password },
    logger: false,
  };

  switch (config.encryption) {
    case 'tls':
      return { ...base, secure: true };
    case 'starttls':
      return { ...base, secure: false, tls: { rejectUnauthorized: true } };
    case 'none':
    default:
      return { ...base, secure: false };
  }
}

/**
 * Parse a References header value into an array of Message-ID strings.
 * References is a space-separated list of `<message-id>` values.
 */
function parseReferences(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/**
 * Extract a single email address string from an imapflow address array.
 */
function extractFromAddress(from: Array<{ name?: string; address?: string }> | undefined): string {
  if (!from || from.length === 0) return '';
  return from[0].address ?? '';
}

/**
 * Build a simple MIME parts array from the raw message source buffer
 * so we can reuse `extractPlainTextFromMime()` from imapUtils.
 *
 * This is a lightweight approach: we split on boundaries for multipart,
 * or treat the whole source as text/plain for simple messages.
 */
function buildMimePartsFromSource(
  source: Buffer,
): Array<{ mimeType: string; body: string; parts?: any[] }> {
  const raw = source.toString('utf-8');
  const headerBodySplit = raw.indexOf('\r\n\r\n');
  if (headerBodySplit === -1) {
    // No body found — return the whole thing as text/plain
    return [{ mimeType: 'text/plain', body: raw }];
  }

  const headerSection = raw.substring(0, headerBodySplit);
  const bodySection = raw.substring(headerBodySplit + 4);

  // Check Content-Type for multipart
  const ctMatch = headerSection.match(/^Content-Type:\s*(.+?)(?:\r?\n(?!\s)|$)/im);
  const contentType = ctMatch ? ctMatch[1].trim() : 'text/plain';

  if (contentType.toLowerCase().startsWith('multipart/')) {
    // Extract boundary
    const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = bodySection.split(`--${boundary}`);
      const mimeParts: Array<{ mimeType: string; body: string; parts?: any[] }> = [];

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed || trimmed === '--') continue;

        const partSplit = trimmed.indexOf('\r\n\r\n');
        if (partSplit === -1) continue;

        const partHeaders = trimmed.substring(0, partSplit);
        const partBody = trimmed.substring(partSplit + 4);

        const partCtMatch = partHeaders.match(/^Content-Type:\s*([^;\r\n]+)/im);
        const partContentType = partCtMatch ? partCtMatch[1].trim().toLowerCase() : 'text/plain';

        mimeParts.push({ mimeType: partContentType, body: partBody });
      }

      return mimeParts;
    }
  }

  // Simple single-part message
  return [{ mimeType: contentType.split(';')[0].trim().toLowerCase(), body: bodySection }];
}

/**
 * Extract a specific header value from raw source.
 */
function extractHeader(source: string, headerName: string): string | undefined {
  // Match header, handling folded headers (continuation lines starting with whitespace)
  const regex = new RegExp(`^${headerName}:\\s*(.+?)(?=\\r?\\n(?!\\s)|$)`, 'ims');
  const match = source.match(regex);
  if (!match) return undefined;
  // Unfold: replace \r\n followed by whitespace with a single space
  return match[1].replace(/\r?\n\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

interface ProviderConfigRow {
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_encryption: 'tls' | 'starttls' | 'none';
  watched_folders: string[];
  poll_interval_minutes: number;
  imap_consecutive_failures: number;
}

interface PollingStateRow {
  last_seen_uid: number;
}
async function getImapConfig(
  founderId: string,
): Promise<(ImapConfig & { consecutiveFailures: number }) | null> {
  const result = await query<ProviderConfigRow>(
    `SELECT imap_host, imap_port, imap_username, imap_password,
            imap_encryption, watched_folders, poll_interval_minutes,
            imap_consecutive_failures
     FROM email_provider_config
     WHERE founder_id = $1 AND is_active = true`,
    [founderId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    host: row.imap_host,
    port: row.imap_port,
    username: row.imap_username,
    encryptedPassword: row.imap_password,
    encryption: row.imap_encryption,
    watchedFolders: row.watched_folders,
    pollIntervalMinutes: row.poll_interval_minutes,
    consecutiveFailures: row.imap_consecutive_failures,
  };
}

async function getLastSeenUid(founderId: string, folder: string): Promise<number> {
  const result = await query<PollingStateRow>(
    `SELECT last_seen_uid FROM imap_polling_state
     WHERE founder_id = $1 AND folder_name = $2`,
    [founderId, folder],
  );
  return result.rows.length > 0 ? result.rows[0].last_seen_uid : 0;
}

async function updatePollingState(
  founderId: string,
  folder: string,
  lastSeenUid: number,
): Promise<void> {
  await query(
    `INSERT INTO imap_polling_state (founder_id, folder_name, last_seen_uid, last_poll_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (founder_id, folder_name)
     DO UPDATE SET last_seen_uid = $3, last_poll_at = NOW(), updated_at = NOW()`,
    [founderId, folder, lastSeenUid],
  );
}

async function resetConsecutiveFailures(founderId: string): Promise<void> {
  await query(
    `UPDATE email_provider_config
     SET imap_consecutive_failures = 0, updated_at = NOW()
     WHERE founder_id = $1`,
    [founderId],
  );
}

async function incrementConsecutiveFailures(founderId: string): Promise<number> {
  const result = await query<{ imap_consecutive_failures: number }>(
    `UPDATE email_provider_config
     SET imap_consecutive_failures = imap_consecutive_failures + 1, updated_at = NOW()
     WHERE founder_id = $1
     RETURNING imap_consecutive_failures`,
    [founderId],
  );
  return result.rows[0]?.imap_consecutive_failures ?? 0;
}

async function deactivateImapConnection(founderId: string): Promise<void> {
  await query(
    `UPDATE email_provider_config
     SET is_active = false, imap_verified = false, updated_at = NOW()
     WHERE founder_id = $1`,
    [founderId],
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Poll the IMAP inbox for a given founder, fetching all messages with
 * UID > last_seen_uid. Updates polling state and tracks consecutive failures.
 */
export async function pollImapInbox(founderId: string): Promise<ImapMessage[]> {
  const config = await getImapConfig(founderId);
  if (!config) {
    console.warn(`[IMAP] No active IMAP config found for founder ${founderId}`);
    return [];
  }

  const password = decrypt(config.encryptedPassword);
  const client = new ImapFlow(buildImapFlowOptions(config, password));

  const allMessages: ImapMessage[] = [];

  try {
    await client.connect();

    // Successful connection — reset failure counter
    await resetConsecutiveFailures(founderId);

    const folders = config.watchedFolders.length > 0 ? config.watchedFolders : ['INBOX'];

    for (const folder of folders) {
      const lastSeenUid = await getLastSeenUid(founderId, folder);

      const lock = await client.getMailboxLock(folder);
      try {
        // Fetch messages with UID > lastSeenUid
        // imapflow uses UID range syntax: "lastSeenUid+1:*"
        const fetchRange = `${lastSeenUid + 1}:*`;
        const fetchedUids: number[] = [];

        for await (const msg of client.fetch(
          fetchRange,
          {
            uid: true,
            envelope: true,
            source: true,
          },
          { uid: true },
        )) {
          // Skip messages at or below lastSeenUid (server may return lastSeenUid itself)
          if (msg.uid <= lastSeenUid) continue;

          fetchedUids.push(msg.uid);

          const envelope = msg.envelope;
          const rawSource = msg.source?.toString('utf-8') ?? '';

          // Extract headers from raw source for rawHeaders
          const messageId = envelope?.messageId ?? extractHeader(rawSource, 'Message-ID') ?? '';
          const inReplyTo = envelope?.inReplyTo ?? extractHeader(rawSource, 'In-Reply-To') ?? null;
          const referencesRaw = extractHeader(rawSource, 'References');
          const references = parseReferences(referencesRaw);
          const from = extractFromAddress(envelope?.from);
          const subject = envelope?.subject ?? '';
          const date = envelope?.date ?? new Date();

          // Extract plain-text body from raw source
          const mimeParts = msg.source ? buildMimePartsFromSource(msg.source) : [];
          const bodyText = extractPlainTextFromMime(mimeParts);

          // Build rawHeaders with the six required header values
          const rawHeaders: Record<string, string> = {
            'Message-ID': messageId,
            'In-Reply-To': inReplyTo ?? '',
            References: referencesRaw ?? '',
            From: extractHeader(rawSource, 'From') ?? from,
            Subject: extractHeader(rawSource, 'Subject') ?? subject,
            Date:
              extractHeader(rawSource, 'Date') ??
              (date instanceof Date ? date.toISOString() : String(date)),
          };

          allMessages.push({
            uid: msg.uid,
            messageId,
            inReplyTo,
            references,
            from,
            subject,
            date: date instanceof Date ? date : new Date(date),
            bodyText,
            rawHeaders,
          });
        }

        // Update last_seen_uid if we fetched any new messages
        if (fetchedUids.length > 0) {
          const newLastSeenUid = computeLastSeenUid(fetchedUids);
          await updatePollingState(founderId, folder, newLastSeenUid);
        } else {
          // Still update last_poll_at even if no new messages
          await updatePollingState(founderId, folder, lastSeenUid);
        }
      } finally {
        lock.release();
      }
    }

    await client.logout();
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[IMAP] Poll failed for founder ${founderId}:`, error.message);

    // Increment consecutive failures and check deactivation threshold
    const failures = await incrementConsecutiveFailures(founderId);
    if (shouldDeactivateConnection(failures)) {
      console.warn(
        `[IMAP] Deactivating IMAP connection for founder ${founderId} after ${failures} consecutive failures`,
      );
      await deactivateImapConnection(founderId);
    }

    // Ensure client is closed on error
    try {
      client.close();
    } catch {
      // Ignore close errors
    }

    return [];
  }

  return allMessages;
}

/**
 * Test an IMAP connection by connecting and immediately disconnecting.
 * Returns success/failure with an optional error message.
 */
export async function testImapConnection(
  config: ImapConfig,
): Promise<{ success: boolean; error?: string }> {
  const password = decrypt(config.encryptedPassword);
  const client = new ImapFlow(buildImapFlowOptions(config, password));

  try {
    await client.connect();
    await client.logout();
    return { success: true };
  } catch (err: unknown) {
    const error = err as Error;
    return { success: false, error: error.message ?? 'Unknown IMAP connection error' };
  }
}
