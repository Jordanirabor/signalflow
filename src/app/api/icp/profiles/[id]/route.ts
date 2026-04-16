import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import {
  deleteICPProfile,
  getICPProfileById,
  updateICPProfile,
} from '@/services/icpProfileService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/icp/profiles/:id
 * Return a single ICP profile by ID.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const profile = await getICPProfileById(id);
    if (!profile) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(profile);
  } catch {
    return dbWriteError('Failed to retrieve ICP profile');
  }
}

/**
 * PUT /api/icp/profiles/:id
 * Validate and update an ICP profile.
 * founderId is derived from the server-side session.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  // Override any client-supplied founderId with session value
  body.founderId = session.founderId;

  try {
    const profile = await updateICPProfile(id, body as Parameters<typeof updateICPProfile>[1]);
    if (!profile) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(profile);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update ICP profile';
    if (message.startsWith('Invalid ICP profile:')) {
      return validationError(message);
    }
    return dbWriteError(message);
  }
}

/**
 * DELETE /api/icp/profiles/:id
 * Delete an ICP profile. Leads are retained via ON DELETE SET NULL.
 *
 * Requirements: 3.1, 3.2, 3.6
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const deleted = await deleteICPProfile(id);
    if (!deleted) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return dbWriteError('Failed to delete ICP profile');
  }
}
