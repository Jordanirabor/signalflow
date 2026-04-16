import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getCalendarConnectionStatus } from '@/services/calendarIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/calendar/status?founderId=<uuid>
 * Returns the current calendar connection status.
 *
 * Requirements: 8.5
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const status = await getCalendarConnectionStatus(founderId);
    return NextResponse.json(status);
  } catch {
    return dbWriteError('Failed to retrieve calendar connection status');
  }
}
