import { dbWriteError, validationError } from '@/lib/apiErrors';
import { handleOAuthCallback } from '@/services/emailIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/oauth/gmail/callback?code=<auth_code>&state=<founderId>
 * Handles the Gmail OAuth 2.0 callback, exchanges code for tokens,
 * stores the encrypted connection, and verifies by sending a test email.
 *
 * Requirements: 9.1, 9.2
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const founderId = request.nextUrl.searchParams.get('state');

  if (!code) {
    return validationError('OAuth authorization code is required', { code: 'missing' });
  }
  if (!founderId) {
    return validationError('state (founderId) parameter is required', { state: 'missing' });
  }

  try {
    const connection = await handleOAuthCallback(founderId, code);
    return NextResponse.json({
      connected: true,
      email: connection.email,
      isActive: connection.isActive,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAuth callback failed';
    return dbWriteError(message);
  }
}
