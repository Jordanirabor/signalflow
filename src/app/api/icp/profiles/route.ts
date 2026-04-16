import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { createICPProfile, getICPSet } from '@/services/icpProfileService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/icp/profiles?projectId=<uuid>
 * Return the full ICPSet for the authenticated founder.
 * Optionally filter by projectId query parameter.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get('projectId') || undefined;

  try {
    const icpSet = await getICPSet(session.founderId, projectId);
    return NextResponse.json(icpSet);
  } catch {
    return dbWriteError('Failed to retrieve ICP profiles');
  }
}

/**
 * POST /api/icp/profiles
 * Create a single ICP profile. Body must include targetRole, industry, painPoints, projectId.
 * founderId is derived from the server-side session.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (
    !body.projectId ||
    typeof body.projectId !== 'string' ||
    (body.projectId as string).trim() === ''
  ) {
    return validationError('projectId is required', { projectId: 'missing' });
  }

  // Override any client-supplied founderId with session value
  body.founderId = session.founderId;

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
