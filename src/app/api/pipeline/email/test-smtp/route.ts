import { validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { encrypt } from '@/services/emailIntegrationService';
import type { SmtpConfig } from '@/services/smtpTransportService';
import { testSmtpConnection } from '@/services/smtpTransportService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/pipeline/email/test-smtp
 * Tests an SMTP connection with the provided config.
 * On success, updates smtp_verified = true in email_provider_config.
 *
 * Requirements: 1.3, 1.4
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { smtpHost, smtpPort, smtpUsername, smtpPassword, smtpEncryption } = body;

  if (!smtpHost || !smtpUsername || !smtpPassword) {
    return validationError('Missing required fields: smtpHost, smtpUsername, smtpPassword');
  }

  const encryptedPassword = encrypt(smtpPassword);

  const config: SmtpConfig = {
    host: smtpHost,
    port: smtpPort ?? 587,
    username: smtpUsername,
    encryptedPassword,
    encryption: smtpEncryption ?? 'tls',
    fromEmail: smtpUsername,
    fromName: '',
  };

  const result = await testSmtpConnection(config);

  if (result.success) {
    try {
      await query(
        `UPDATE email_provider_config SET smtp_verified = true, updated_at = NOW() WHERE founder_id = $1`,
        [session.founderId],
      );
    } catch {
      // Config row may not exist yet — that's fine, verification still succeeded
    }
  }

  return NextResponse.json(result);
}
