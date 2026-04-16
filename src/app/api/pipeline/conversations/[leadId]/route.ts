import { dbWriteError, validationError } from '@/lib/apiErrors';
import { query } from '@/lib/db';
import { getConversationThread } from '@/services/pipelineMetricsService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/conversations/[leadId]?founderId=<uuid>
 * Single conversation thread with all sent/received messages in chronological order.
 *
 * Requirements: 11.3
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    // Fetch lead info for the thread header
    const leadResult = await query(
      `SELECT id, name, company FROM lead WHERE id = $1 AND founder_id = $2 AND is_deleted = false`,
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
      messages,
    });
  } catch {
    return dbWriteError('Failed to retrieve conversation thread');
  }
}
