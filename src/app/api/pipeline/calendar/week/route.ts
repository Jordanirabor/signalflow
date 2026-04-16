import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getWeekCalendarEvents } from '@/services/pipelineMetricsService';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/calendar/week
 * Current week calendar with booked meetings.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 11.7
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const events = await getWeekCalendarEvents(session.founderId);
    return NextResponse.json(events);
  } catch {
    return dbWriteError('Failed to retrieve calendar events');
  }
}
