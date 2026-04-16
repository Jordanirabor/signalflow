import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import {
  getThrottleConfig,
  saveThrottleConfig,
  validateThrottleLimits,
} from '@/services/throttleService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/throttle/config
 * Returns the current throttle configuration (or defaults).
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const config = await getThrottleConfig(session.founderId);
    return NextResponse.json(config);
  } catch {
    return dbWriteError('Failed to retrieve throttle config');
  }
}

/**
 * PUT /api/throttle/config
 * Update throttle limits. Validates range [5, 50].
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 9.4, 9.5
 */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { emailLimit?: number; dmLimit?: number };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (body.emailLimit === undefined && body.dmLimit === undefined) {
    return validationError('At least one of emailLimit or dmLimit must be provided', {
      emailLimit: 'missing',
      dmLimit: 'missing',
    });
  }

  const validation = validateThrottleLimits(body.emailLimit, body.dmLimit);
  if (!validation.valid) {
    return validationError('Throttle limits out of allowed range [5, 50]', validation.errors);
  }

  try {
    // Get current config to fill in defaults for unspecified fields
    const current = await getThrottleConfig(session.founderId);
    const emailLimit = body.emailLimit ?? current.emailLimit;
    const dmLimit = body.dmLimit ?? current.dmLimit;

    const config = await saveThrottleConfig(session.founderId, emailLimit, dmLimit);
    return NextResponse.json(config);
  } catch {
    return dbWriteError('Failed to update throttle config');
  }
}
