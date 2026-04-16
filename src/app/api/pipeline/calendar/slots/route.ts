import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getAvailableSlots } from '@/services/calendarIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/calendar/slots?founderId=<uuid>
 * Returns available meeting slots for the next 7 days.
 *
 * Requirements: 8.3
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    const slots = await getAvailableSlots(founderId, startDate, endDate);
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
