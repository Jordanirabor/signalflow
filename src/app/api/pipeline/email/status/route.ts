import { getSession } from '@/lib/auth';
import { getProviderConnectionStatus } from '@/services/emailTransportService';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/email/status
 * Returns the active provider connection status for the session founder.
 *
 * Requirements: 9.1
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getProviderConnectionStatus(session.founderId);
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: 'Failed to retrieve provider status' }, { status: 500 });
  }
}
