import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getConnectionStatus } from '@/services/emailIntegrationService';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/email/status
 * Returns the current email connection status.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 9.5
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getConnectionStatus(session.founderId);
    return NextResponse.json(status);
  } catch {
    return dbWriteError('Failed to retrieve email connection status');
  }
}
