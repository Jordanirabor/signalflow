import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import {
  disconnectCalendar,
  getAvailabilityWindows,
  upsertAvailabilityWindow,
} from '@/services/calendarIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/calendar
 * Returns the founder's availability windows.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 8.6
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const windows = await getAvailabilityWindows(session.founderId);
    return NextResponse.json(windows);
  } catch {
    return dbWriteError('Failed to retrieve availability windows');
  }
}

/**
 * PUT /api/pipeline/calendar
 * Upserts an availability window for a given day of the week.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 8.6
 */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { dayOfWeek, startTime, endTime, timezone } = body;

  if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) {
    return validationError('dayOfWeek must be 0–6', { dayOfWeek: 'invalid' });
  }

  try {
    const window = await upsertAvailabilityWindow(
      session.founderId,
      dayOfWeek,
      startTime ?? '09:00',
      endTime ?? '17:00',
      timezone ?? 'America/New_York',
    );
    return NextResponse.json(window);
  } catch {
    return dbWriteError('Failed to save availability window');
  }
}

/**
 * DELETE /api/pipeline/calendar
 * Disconnects the founder's calendar integration.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 8.5
 */
export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await disconnectCalendar(session.founderId);
    return NextResponse.json({ disconnected: true });
  } catch {
    return dbWriteError('Failed to disconnect calendar');
  }
}
