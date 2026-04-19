import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { maskPassword } from '@/lib/credentialUtils';
import { query } from '@/lib/db';
import { validatePollInterval } from '@/lib/imapUtils';
import { encrypt } from '@/services/emailIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

interface EmailProviderConfigRow {
  id: string;
  founder_id: string;
  provider_type: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_encryption: string;
  from_email: string;
  from_name: string;
  reply_to_email: string | null;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_encryption: string;
  watched_folders: string[];
  poll_interval_minutes: number;
  smtp_verified: boolean;
  imap_verified: boolean;
  imap_consecutive_failures: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/pipeline/email/provider
 * Returns the current SMTP/IMAP provider config for the session founder.
 * Passwords are masked for safe display.
 *
 * Requirements: 1.1, 1.8, 8.3
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await query<EmailProviderConfigRow>(
      'SELECT * FROM email_provider_config WHERE founder_id = $1',
      [session.founderId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(null);
    }

    const row = result.rows[0];
    return NextResponse.json({
      id: row.id,
      founderId: row.founder_id,
      providerType: row.provider_type,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpUsername: row.smtp_username,
      smtpPassword: maskPassword(row.smtp_password),
      smtpEncryption: row.smtp_encryption,
      fromEmail: row.from_email,
      fromName: row.from_name,
      replyToEmail: row.reply_to_email,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      imapUsername: row.imap_username,
      imapPassword: maskPassword(row.imap_password),
      imapEncryption: row.imap_encryption,
      watchedFolders: row.watched_folders,
      pollIntervalMinutes: row.poll_interval_minutes,
      smtpVerified: row.smtp_verified,
      imapVerified: row.imap_verified,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch {
    return dbWriteError('Failed to retrieve provider config');
  }
}

/**
 * PUT /api/pipeline/email/provider
 * Creates or updates the SMTP/IMAP provider config for the session founder.
 * Encrypts passwords before storage and validates the poll interval.
 *
 * Requirements: 1.1, 1.2, 1.5, 3.1, 3.2, 3.5, 3.6, 8.1, 8.2
 */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  const {
    smtpHost,
    smtpPort,
    smtpUsername,
    smtpPassword,
    smtpEncryption,
    fromEmail,
    fromName,
    replyToEmail,
    imapHost,
    imapPort,
    imapUsername,
    imapPassword,
    imapEncryption,
    watchedFolders,
    pollIntervalMinutes,
  } = body;

  // Validate required fields
  if (!smtpHost || !smtpUsername || !smtpPassword || !fromEmail) {
    return validationError(
      'Missing required SMTP fields: smtpHost, smtpUsername, smtpPassword, fromEmail',
    );
  }
  if (!imapHost || !imapUsername || !imapPassword) {
    return validationError('Missing required IMAP fields: imapHost, imapUsername, imapPassword');
  }

  // Validate poll interval
  if (pollIntervalMinutes !== undefined) {
    const intervalCheck = validatePollInterval(pollIntervalMinutes);
    if (!intervalCheck.valid) {
      return validationError(intervalCheck.error!);
    }
  }

  const encryptedSmtpPassword = encrypt(smtpPassword);
  const encryptedImapPassword = encrypt(imapPassword);

  try {
    const result = await query<EmailProviderConfigRow>(
      `INSERT INTO email_provider_config (
        founder_id, provider_type,
        smtp_host, smtp_port, smtp_username, smtp_password, smtp_encryption,
        from_email, from_name, reply_to_email,
        imap_host, imap_port, imap_username, imap_password, imap_encryption,
        watched_folders, poll_interval_minutes,
        updated_at
      ) VALUES (
        $1, 'smtp_imap',
        $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16,
        NOW()
      )
      ON CONFLICT (founder_id) DO UPDATE SET
        smtp_host = EXCLUDED.smtp_host,
        smtp_port = EXCLUDED.smtp_port,
        smtp_username = EXCLUDED.smtp_username,
        smtp_password = EXCLUDED.smtp_password,
        smtp_encryption = EXCLUDED.smtp_encryption,
        from_email = EXCLUDED.from_email,
        from_name = EXCLUDED.from_name,
        reply_to_email = EXCLUDED.reply_to_email,
        imap_host = EXCLUDED.imap_host,
        imap_port = EXCLUDED.imap_port,
        imap_username = EXCLUDED.imap_username,
        imap_password = EXCLUDED.imap_password,
        imap_encryption = EXCLUDED.imap_encryption,
        watched_folders = EXCLUDED.watched_folders,
        poll_interval_minutes = EXCLUDED.poll_interval_minutes,
        updated_at = NOW()
      RETURNING *`,
      [
        session.founderId,
        smtpHost,
        smtpPort ?? 587,
        smtpUsername,
        encryptedSmtpPassword,
        smtpEncryption ?? 'tls',
        fromEmail,
        fromName ?? '',
        replyToEmail ?? null,
        imapHost,
        imapPort ?? 993,
        imapUsername,
        encryptedImapPassword,
        imapEncryption ?? 'tls',
        watchedFolders ?? ['INBOX'],
        pollIntervalMinutes ?? 5,
      ],
    );

    const row = result.rows[0];
    return NextResponse.json({
      id: row.id,
      founderId: row.founder_id,
      providerType: row.provider_type,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpUsername: row.smtp_username,
      smtpPassword: maskPassword(row.smtp_password),
      smtpEncryption: row.smtp_encryption,
      fromEmail: row.from_email,
      fromName: row.from_name,
      replyToEmail: row.reply_to_email,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      imapUsername: row.imap_username,
      imapPassword: maskPassword(row.imap_password),
      imapEncryption: row.imap_encryption,
      watchedFolders: row.watched_folders,
      pollIntervalMinutes: row.poll_interval_minutes,
      smtpVerified: row.smtp_verified,
      imapVerified: row.imap_verified,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch {
    return dbWriteError('Failed to save provider config');
  }
}

/**
 * DELETE /api/pipeline/email/provider
 * Deletes the SMTP/IMAP provider config for the session founder.
 *
 * Requirements: 1.8
 */
export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await query('DELETE FROM email_provider_config WHERE founder_id = $1', [session.founderId]);
    return NextResponse.json({ deleted: true });
  } catch {
    return dbWriteError('Failed to delete provider config');
  }
}
