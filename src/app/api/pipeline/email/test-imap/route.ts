import { validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { encrypt } from '@/services/emailIntegrationService';
import type { ImapConfig } from '@/services/imapMonitorService';
import { testImapConnection } from '@/services/imapMonitorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/pipeline/email/test-imap
 * Tests an IMAP connection with the provided config.
 * On success, updates imap_verified = true in email_provider_config.
 *
 * Requirements: 3.3, 3.4
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { imapHost, imapPort, imapUsername, imapPassword, imapEncryption } = body;

  if (!imapHost || !imapUsername || !imapPassword) {
    return validationError('Missing required fields: imapHost, imapUsername, imapPassword');
  }

  const encryptedPassword = encrypt(imapPassword);

  const config: ImapConfig = {
    host: imapHost,
    port: imapPort ?? 993,
    username: imapUsername,
    encryptedPassword,
    encryption: imapEncryption ?? 'tls',
    watchedFolders: ['INBOX'],
    pollIntervalMinutes: 5,
  };

  const result = await testImapConnection(config);

  if (result.success) {
    try {
      await query(
        `UPDATE email_provider_config SET imap_verified = true, updated_at = NOW() WHERE founder_id = $1`,
        [session.founderId],
      );
    } catch {
      // Config row may not exist yet — that's fine, verification still succeeded
    }
  }

  return NextResponse.json(result);
}
