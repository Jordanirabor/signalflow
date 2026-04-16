import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { NextResponse } from 'next/server';

/**
 * POST /api/leads/cleanup
 *
 * Purges soft-deleted lead records older than 30 days, along with
 * their associated child records (outreach, status changes, call notes, tags).
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 10.5
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    // Delete child records first (foreign key constraints), then the leads.
    // We use a CTE to identify the target lead IDs once, scoped to this founder.
    const result = await query<{ purged: number }>(
      `
      WITH expired_leads AS (
        SELECT id FROM lead
        WHERE founder_id = $2 AND is_deleted = true AND deleted_at IS NOT NULL AND deleted_at < $1
      ),
      deleted_tags AS (
        DELETE FROM tag
        WHERE call_note_id IN (
          SELECT cn.id FROM call_note cn
          JOIN expired_leads el ON cn.lead_id = el.id
        )
      ),
      deleted_call_notes AS (
        DELETE FROM call_note WHERE lead_id IN (SELECT id FROM expired_leads)
      ),
      deleted_status_changes AS (
        DELETE FROM status_change WHERE lead_id IN (SELECT id FROM expired_leads)
      ),
      deleted_outreach AS (
        DELETE FROM outreach_record WHERE lead_id IN (SELECT id FROM expired_leads)
      ),
      deleted_leads AS (
        DELETE FROM lead WHERE id IN (SELECT id FROM expired_leads)
        RETURNING id
      )
      SELECT COUNT(*)::int AS purged FROM deleted_leads
      `,
      [cutoff.toISOString(), session.founderId],
    );

    const purged = result.rows[0]?.purged ?? 0;

    return NextResponse.json({
      purged,
      cutoffDate: cutoff.toISOString(),
      message: `Purged ${purged} soft-deleted lead(s) older than 30 days.`,
    });
  } catch (err) {
    console.error('Cleanup job failed:', err);
    return dbWriteError('Failed to purge soft-deleted records. Please try again.');
  }
}
