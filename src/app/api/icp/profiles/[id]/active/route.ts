import { dbWriteError, validationError } from '@/lib/apiErrors';
import { setProfileActive } from '@/services/icpProfileService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/icp/profiles/:id/active
 * Toggle a profile's active/inactive state.
 *
 * Request body: { isActive: boolean }
 *
 * Requirements: 3.3, 3.4
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (typeof body.isActive !== 'boolean') {
    return validationError('isActive must be a boolean');
  }

  try {
    const profile = await setProfileActive(id, body.isActive);
    if (!profile) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(profile);
  } catch {
    return dbWriteError('Failed to update profile active state');
  }
}
