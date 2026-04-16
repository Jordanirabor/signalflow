import { getSession } from '@/lib/auth';
import { getCalendarAuthorizeUrl } from '@/services/calendarIntegrationService';
import { NextResponse } from 'next/server';

/**
 * GET /api/oauth/calendar/authorize
 * Initiates the Google Calendar OAuth 2.0 flow by returning the authorization URL.
 * founderId is derived from the server-side session.
 *
 * Requirements: 8.1
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authorizeUrl = getCalendarAuthorizeUrl(session.founderId);
  return NextResponse.json({ authorizeUrl });
}
