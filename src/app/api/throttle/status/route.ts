import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getThrottleStatus } from '@/services/throttleService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/throttle/status
 * Returns current throttle usage, limits, remaining capacity, and warning flag.
 * If no channel is specified, returns status for both channels.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 9.1, 9.2, 9.3
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const channel = request.nextUrl.searchParams.get('channel') as 'email' | 'dm' | null;
  if (channel && channel !== 'email' && channel !== 'dm') {
    return validationError('channel must be "email" or "dm"', { channel: 'invalid' });
  }

  try {
    if (channel) {
      const status = await getThrottleStatus(session.founderId, channel);
      return NextResponse.json(status);
    }

    // Return both channels
    const [emailStatus, dmStatus] = await Promise.all([
      getThrottleStatus(session.founderId, 'email'),
      getThrottleStatus(session.founderId, 'dm'),
    ]);
    return NextResponse.json({ email: emailStatus, dm: dmStatus });
  } catch {
    return dbWriteError('Failed to retrieve throttle status');
  }
}
