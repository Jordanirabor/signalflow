import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { getConversationThread } from '@/services/pipelineMetricsService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/conversations/[leadId]
 * Single conversation thread with all sent/received messages in chronological order.
 *
 * Requirements: 11.3
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { leadId } = await params;
  const founderId = session.founderId;

  try {
    // Fetch lead info for the thread header
    const leadResult = await query(
      `SELECT id, name, company, email FROM lead WHERE id = $1 AND founder_id = $2 AND is_deleted = false`,
      [leadId, founderId],
    );

    if (leadResult.rows.length === 0) {
      return validationError('Lead not found', { leadId: 'not_found' });
    }

    const lead = leadResult.rows[0];
    const messages = await getConversationThread(founderId, leadId);

    return NextResponse.json({
      leadId: lead.id,
      leadName: lead.name,
      company: lead.company,
      email: lead.email ?? undefined,
      messages,
    });
  } catch {
    return dbWriteError('Failed to retrieve conversation thread');
  }
}
