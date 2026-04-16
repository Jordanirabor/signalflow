import { dbWriteError, validationError } from '@/lib/apiErrors';
import { handleCalendarOAuthCallback } from '@/services/calendarIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/oauth/calendar/callback?code=<auth_code>&state=<founderId>
 * Handles the Google Calendar OAuth 2.0 callback, exchanges code for tokens,
 * stores the encrypted connection, and verifies by reading upcoming events.
 *
 * Requirements: 8.1, 8.2
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
    const connection = await handleCalendarOAuthCallback(founderId, code);
    return NextResponse.json({
      connected: true,
      calendarId: connection.calendarId,
      isActive: connection.isActive,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAuth callback failed';
    return dbWriteError(message);
  }
}
