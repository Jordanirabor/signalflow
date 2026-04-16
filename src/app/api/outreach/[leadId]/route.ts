import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getOutreachHistory } from '@/services/outreachService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ leadId: string }> };

/**
 * GET /api/outreach/:leadId
 * Get chronological outreach history for a lead.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 5.2
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
