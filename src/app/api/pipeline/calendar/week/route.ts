import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getWeekCalendarEvents } from '@/services/pipelineMetricsService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/calendar/week?founderId=<uuid>
 * Current week calendar with booked meetings.
 *
 * Requirements: 11.7
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const events = await getWeekCalendarEvents(founderId);
    return NextResponse.json(events);
  } catch {
    return dbWriteError('Failed to retrieve calendar events');
  }
}
