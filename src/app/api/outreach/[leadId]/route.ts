import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getOutreachHistory } from '@/services/outreachService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ leadId: string }> };

/**
 * GET /api/outreach/:leadId
 * Get chronological outreach history for a lead.
 *
 * Requirements: 5.2
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { leadId } = await context.params;

  if (!leadId) {
    return validationError('leadId is required', { leadId: 'missing' });
  }

  try {
    const history = await getOutreachHistory(leadId);
    return NextResponse.json(history);
  } catch {
    return dbWriteError('Failed to retrieve outreach history');
  }
}
