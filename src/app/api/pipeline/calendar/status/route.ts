import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getCalendarConnectionStatus } from '@/services/calendarIntegrationService';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/calendar/status
 * Returns the current calendar connection status.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 8.5
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getCalendarConnectionStatus(session.founderId);
    return NextResponse.json(status);
  } catch {
    return dbWriteError('Failed to retrieve calendar connection status');
  }
}
