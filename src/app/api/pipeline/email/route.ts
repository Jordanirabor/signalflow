import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { disconnectEmail, updateEmailSettings } from '@/services/emailIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * PUT /api/pipeline/email
 * Updates the founder's email sending name and signature.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 9.6
 */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { sendingName, emailSignature } = body;

  try {
    await updateEmailSettings(session.founderId, sendingName ?? '', emailSignature ?? '');
    return NextResponse.json({ updated: true });
  } catch {
    return dbWriteError('Failed to update email settings');
  }
}

/**
 * DELETE /api/pipeline/email
 * Disconnects the founder's email integration.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 9.5
 */
export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await disconnectEmail(session.founderId);
    return NextResponse.json({ disconnected: true });
  } catch {
    return dbWriteError('Failed to disconnect email');
  }
}
