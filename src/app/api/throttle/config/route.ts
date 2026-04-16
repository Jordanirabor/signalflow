import { dbWriteError, validationError } from '@/lib/apiErrors';
import {
  getThrottleConfig,
  saveThrottleConfig,
  validateThrottleLimits,
} from '@/services/throttleService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/throttle/config?founderId=<uuid>
 * Returns the current throttle configuration (or defaults).
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const config = await getThrottleConfig(founderId);
    return NextResponse.json(config);
  } catch {
    return dbWriteError('Failed to retrieve throttle config');
  }
}

/**
 * PUT /api/throttle/config
 * Update throttle limits. Validates range [5, 50].
 *
 * Requirements: 9.4, 9.5
 */
export async function PUT(request: NextRequest) {
  let body: { founderId?: string; emailLimit?: number; dmLimit?: number };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
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
    const current = await getThrottleConfig(body.founderId);
    const emailLimit = body.emailLimit ?? current.emailLimit;
    const dmLimit = body.dmLimit ?? current.dmLimit;

    const config = await saveThrottleConfig(body.founderId, emailLimit, dmLimit);
    return NextResponse.json(config);
  } catch {
    return dbWriteError('Failed to update throttle config');
  }
}
