import { dbWriteError, validationError } from '@/lib/apiErrors';
import { disconnectEmail, updateEmailSettings } from '@/services/emailIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * PUT /api/pipeline/email
 * Updates the founder's email sending name and signature.
 *
 * Requirements: 9.6
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { founderId, sendingName, emailSignature } = body;
  if (!founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  try {
    await updateEmailSettings(founderId, sendingName ?? '', emailSignature ?? '');
    return NextResponse.json({ updated: true });
  } catch {
    return dbWriteError('Failed to update email settings');
  }
}

/**
 * DELETE /api/pipeline/email?founderId=<uuid>
 * Disconnects the founder's email integration.
 *
 * Requirements: 9.5
 */
export async function DELETE(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    await disconnectEmail(founderId);
    return NextResponse.json({ disconnected: true });
  } catch {
    return dbWriteError('Failed to disconnect email');
  }
}
