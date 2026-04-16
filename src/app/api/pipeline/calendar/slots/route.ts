import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getAvailableSlots } from '@/services/calendarIntegrationService';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/calendar/slots
 * Returns available meeting slots for the next 7 days.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 8.3
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    const slots = await getAvailableSlots(session.founderId, startDate, endDate);
    return NextResponse.json({ slots });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve available slots';
    if (message === 'CALENDAR_NOT_CONNECTED') {
      return validationError(
        'Calendar is not connected. Please connect your Google Calendar first.',
        {
          error: 'CALENDAR_NOT_CONNECTED',
        },
      );
    }
    return dbWriteError(message);
  }
}
