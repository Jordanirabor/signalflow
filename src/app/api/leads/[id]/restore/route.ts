import { dbWriteError } from '@/lib/apiErrors';
import { restoreLead } from '@/services/leadService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/leads/:id/restore
 * Restore a soft-deleted lead.
 *
 * Requirements: 10.5
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const lead = await restoreLead(id);
    if (!lead) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(lead);
  } catch {
    return dbWriteError('Failed to restore lead');
  }
}
