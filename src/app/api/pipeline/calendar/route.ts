import { dbWriteError, validationError } from '@/lib/apiErrors';
import {
  disconnectCalendar,
  getAvailabilityWindows,
  upsertAvailabilityWindow,
} from '@/services/calendarIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/calendar?founderId=<uuid>
 * Returns the founder's availability windows.
 *
 * Requirements: 8.6
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const windows = await getAvailabilityWindows(founderId);
    return NextResponse.json(windows);
  } catch {
    return dbWriteError('Failed to retrieve availability windows');
  }
}

/**
 * PUT /api/pipeline/calendar
 * Upserts an availability window for a given day of the week.
 *
 * Requirements: 8.6
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { founderId, dayOfWeek, startTime, endTime, timezone } = body;
  if (!founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }
  if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) {
    return validationError('dayOfWeek must be 0–6', { dayOfWeek: 'invalid' });
  }

  try {
    const window = await upsertAvailabilityWindow(
      founderId,
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
 * DELETE /api/pipeline/calendar?founderId=<uuid>
 * Disconnects the founder's calendar integration.
 *
 * Requirements: 8.5
 */
export async function DELETE(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    await disconnectCalendar(founderId);
    return NextResponse.json({ disconnected: true });
  } catch {
    return dbWriteError('Failed to disconnect calendar');
  }
}
