import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { recalculateCorrelationScores } from '@/services/correlationEngineService';
import { getICP } from '@/services/icpService';
import { calculateLeadScore } from '@/services/scoringService';
import type { EnrichmentData } from '@/types';
import { NextResponse } from 'next/server';

/**
 * POST /api/leads/recalculate
 * Internal endpoint: recalculates lead scores for all non-deleted leads
 * belonging to a founder, using their current ICP.
 *
 * Triggered by ICP save (task 2.1).
 * Requirements: 1.4, 3.1, 3.2, 3.3, 3.4, 3.7
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const founderId = session.founderId;

  try {
    // 1. Fetch the founder's current ICP
    const icp = await getICP(founderId);
    if (!icp) {
      return validationError('No ICP found for this founder. Define an ICP first.', {
        icp: 'not_found',
      });
    }

    // 2. Fetch all non-deleted leads for this founder
    const leadsResult = await query<{
      id: string;
      role: string;
      company: string;
      industry: string | null;
      geography: string | null;
      enrichment_data: EnrichmentData | null;
    }>(
      `SELECT id, role, company, industry, geography, enrichment_data
       FROM lead
       WHERE founder_id = $1 AND is_deleted = false`,
      [founderId],
    );

    const leads = leadsResult.rows;
    let updated = 0;

    // 3. Recalculate and update each lead
    for (const row of leads) {
      const scoringResult = calculateLeadScore({
        lead: {
          role: row.role,
          company: row.company,
          industry: row.industry ?? undefined,
          geography: row.geography ?? undefined,
          enrichmentData: row.enrichment_data ?? undefined,
        },
        icp,
      });

      await query(
        `UPDATE lead
         SET lead_score = $1, score_breakdown = $2, updated_at = NOW()
         WHERE id = $3`,
        [scoringResult.totalScore, JSON.stringify(scoringResult.breakdown), row.id],
      );

      updated++;
    }

    // 4. Recalculate Correlation Scores for all leads
    await recalculateCorrelationScores(founderId);

    return NextResponse.json({ updated, founderId }, { status: 200 });
  } catch {
    return dbWriteError('Failed to recalculate lead scores');
  }
}
