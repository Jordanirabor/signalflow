import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getThrottleStatus } from '@/services/throttleService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/throttle/status?founderId=<uuid>&channel=<email|dm>
 * Returns current throttle usage, limits, remaining capacity, and warning flag.
 * If no channel is specified, returns status for both channels.
 *
 * Requirements: 9.1, 9.2, 9.3
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  const channel = request.nextUrl.searchParams.get('channel') as 'email' | 'dm' | null;
  if (channel && channel !== 'email' && channel !== 'dm') {
    return validationError('channel must be "email" or "dm"', { channel: 'invalid' });
  }

  try {
    if (channel) {
      const status = await getThrottleStatus(founderId, channel);
      return NextResponse.json(status);
    }

    // Return both channels
    const [emailStatus, dmStatus] = await Promise.all([
      getThrottleStatus(founderId, 'email'),
      getThrottleStatus(founderId, 'dm'),
    ]);
    return NextResponse.json({ email: emailStatus, dm: dmStatus });
  } catch {
    return dbWriteError('Failed to retrieve throttle status');
  }
}
