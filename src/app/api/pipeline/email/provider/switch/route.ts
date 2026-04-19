import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

const VALID_PROVIDERS = ['gmail', 'smtp_imap'] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

interface EmailProviderConfigRow {
  smtp_verified: boolean;
  imap_verified: boolean;
}

interface EmailConnectionRow {
  id: string;
  active_provider: string;
  is_active: boolean;
}

/**
 * POST /api/pipeline/email/provider/switch
 * Switches the active email provider for the session founder.
 * Verifies the target provider is configured and tested before switching.
 *
 * Requirements: 1.6, 1.7
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { provider } = body as { provider?: string };

  if (!provider || !VALID_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json(
      {
        error: 'VALIDATION_ERROR',
        message: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const targetProvider = provider as Provider;

  if (targetProvider === 'smtp_imap') {
    // Verify email_provider_config exists and both SMTP and IMAP are verified
    const configResult = await query<EmailProviderConfigRow>(
      'SELECT smtp_verified, imap_verified FROM email_provider_config WHERE founder_id = $1',
      [session.founderId],
    );

    if (configResult.rows.length === 0) {
      return NextResponse.json(
        {
          error: 'PROVIDER_NOT_CONFIGURED',
          message: 'SMTP/IMAP provider is not configured. Please configure it first.',
        },
        { status: 400 },
      );
    }

    const config = configResult.rows[0];
    if (!config.smtp_verified || !config.imap_verified) {
      return NextResponse.json(
        {
          error: 'PROVIDER_NOT_VERIFIED',
          message:
            'SMTP and IMAP connections must both be verified before switching. Please test your connections first.',
        },
        { status: 400 },
      );
    }
  }

  if (targetProvider === 'gmail') {
    // Verify email_connection exists and is active
    const connResult = await query<EmailConnectionRow>(
      'SELECT id, active_provider, is_active FROM email_connection WHERE founder_id = $1',
      [session.founderId],
    );

    if (connResult.rows.length === 0 || !connResult.rows[0].is_active) {
      return NextResponse.json(
        {
          error: 'PROVIDER_NOT_CONFIGURED',
          message: 'Gmail OAuth is not connected. Please connect your Gmail account first.',
        },
        { status: 400 },
      );
    }
  }

  // Update or create email_connection with the target provider
  const updateResult = await query<EmailConnectionRow>(
    `UPDATE email_connection
     SET active_provider = $1
     WHERE founder_id = $2
     RETURNING id, active_provider, is_active`,
    [targetProvider, session.founderId],
  );

  if (updateResult.rows.length === 0) {
    // No email_connection row exists — create one for SMTP/IMAP users
    if (targetProvider === 'smtp_imap') {
      const configResult2 = await query<{ from_email: string }>(
        'SELECT from_email FROM email_provider_config WHERE founder_id = $1',
        [session.founderId],
      );
      const email = configResult2.rows[0]?.from_email ?? '';

      const insertResult = await query<EmailConnectionRow>(
        `INSERT INTO email_connection (founder_id, email, provider, active_provider, access_token, refresh_token, token_expires_at, is_active)
         VALUES ($1, $2, 'smtp_imap', 'smtp_imap', '', '', NOW(), true)
         RETURNING id, active_provider, is_active`,
        [session.founderId, email],
      );

      const inserted = insertResult.rows[0];
      return NextResponse.json({
        activeProvider: inserted.active_provider,
        isActive: inserted.is_active,
      });
    }

    return NextResponse.json(
      {
        error: 'PROVIDER_NOT_CONFIGURED',
        message: 'No email connection found. Please connect an email provider first.',
      },
      { status: 400 },
    );
  }

  const updated = updateResult.rows[0];
  return NextResponse.json({
    activeProvider: updated.active_provider,
    isActive: updated.is_active,
  });
}
