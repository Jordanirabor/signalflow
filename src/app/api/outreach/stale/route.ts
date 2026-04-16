import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getStaleLeads } from '@/services/outreachService';
import { NextResponse } from 'next/server';

/**
 * GET /api/outreach/stale
 * Get leads contacted 7+ days ago with no reply.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 5.4
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const staleLeads = await getStaleLeads(session.founderId);
    return NextResponse.json(staleLeads);
  } catch {
    return dbWriteError('Failed to retrieve stale leads');
  }
}
