import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { NextResponse } from 'next/server';

/**
 * GET /api/outreach/history
 * Returns all outreach records for the authenticated founder,
 * joined with lead data for name and company.
 * Ordered by outreach_date DESC (most recent first).
 *
 * Requirements: 12.2
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await query<{
      id: string;
      lead_id: string;
      lead_name: string;
      lead_company: string;
      channel: 'email' | 'dm';
      message_content: string;
      outreach_date: Date;
      is_follow_up: boolean;
    }>(
      `SELECT
         o.id,
         o.lead_id,
         l.name AS lead_name,
         l.company AS lead_company,
         o.channel,
         o.message_content,
         o.outreach_date,
         o.is_follow_up
       FROM outreach_record o
       JOIN lead l ON l.id = o.lead_id
       WHERE o.founder_id = $1
       ORDER BY o.outreach_date DESC`,
      [session.founderId],
    );

    const history = result.rows.map((row) => ({
      id: row.id,
      leadId: row.lead_id,
      leadName: row.lead_name,
      leadCompany: row.lead_company,
      channel: row.channel,
      messageContent: row.message_content,
      outreachDate: row.outreach_date,
      isFollowUp: row.is_follow_up,
    }));

    return NextResponse.json(history);
  } catch {
    return dbWriteError('Failed to retrieve outreach history');
  }
}
