import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { NextResponse } from 'next/server';

/**
 * GET /api/outreach/summary
 * Returns outreach summary stats for the authenticated founder:
 * totalSent, replyCount, replyRate.
 *
 * Requirements: 12.1
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sentResult = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM outreach_record WHERE founder_id = $1`,
      [session.founderId],
    );

    const replyResult = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM incoming_reply WHERE founder_id = $1`,
      [session.founderId],
    );

    const totalSent = parseInt(sentResult.rows[0].count, 10);
    const replyCount = parseInt(replyResult.rows[0].count, 10);
    const replyRate = totalSent > 0 ? (replyCount / totalSent) * 100 : 0;

    return NextResponse.json({ totalSent, replyCount, replyRate });
  } catch {
    return dbWriteError('Failed to retrieve outreach summary');
  }
}
