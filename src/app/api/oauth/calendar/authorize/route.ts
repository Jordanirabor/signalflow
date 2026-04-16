import { validationError } from '@/lib/apiErrors';
import { getCalendarAuthorizeUrl } from '@/services/calendarIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/oauth/calendar/authorize?founderId=<uuid>
 * Initiates the Google Calendar OAuth 2.0 flow by returning the authorization URL.
 *
 * Requirements: 8.1
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  const authorizeUrl = getCalendarAuthorizeUrl(founderId);
  return NextResponse.json({ authorizeUrl });
}
