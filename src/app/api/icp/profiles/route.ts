import { dbWriteError, validationError } from '@/lib/apiErrors';
import { createICPProfile, getICPSet } from '@/services/icpProfileService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/icp/profiles?founderId=<uuid>
 * Return the full ICPSet for a founder.
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');

  if (!founderId) {
    return validationError('founderId query parameter is required', {
      founderId: 'missing',
    });
  }

  try {
    const icpSet = await getICPSet(founderId);
    return NextResponse.json(icpSet);
  } catch {
    return dbWriteError('Failed to retrieve ICP profiles');
  }
}

/**
 * POST /api/icp/profiles
 * Create a single ICP profile. Body must include founderId, targetRole, industry, painPoints.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  try {
    const profile = await createICPProfile(body as Parameters<typeof createICPProfile>[0]);
    return NextResponse.json(profile, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create ICP profile';
    if (message.startsWith('Invalid ICP profile:')) {
      return validationError(message);
    }
    return dbWriteError(message);
  }
}
