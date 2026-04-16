import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getStaleLeads } from '@/services/outreachService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/outreach/stale?founderId=<uuid>
 * Get leads contacted 7+ days ago with no reply.
 *
 * Requirements: 5.4
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const staleLeads = await getStaleLeads(founderId);
    return NextResponse.json(staleLeads);
  } catch {
    return dbWriteError('Failed to retrieve stale leads');
  }
}
