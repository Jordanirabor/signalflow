import { dbWriteError, validationError } from '@/lib/apiErrors';
import { query } from '@/lib/db';
import { replaceICPSet } from '@/services/icpProfileService';
import { calculateLeadScoreV2 } from '@/services/scoringService';
import type { EnrichmentData, ICPProfile, ScoreBreakdownV2 } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/icp/generate/confirm
 * Accept generated ICP profiles and persist them via replaceICPSet.
 * After saving, re-score all active leads against the new ICP_Set,
 * associating each lead with the best-matching profile.
 *
 * Body: { founderId: string, profiles: Array<profile data> }
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */
export async function POST(request: NextRequest) {
  let body: { founderId?: string; profiles?: Partial<ICPProfile>[] };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  const founderId = body.founderId?.trim();
  if (!founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  if (!Array.isArray(body.profiles) || body.profiles.length === 0) {
    return validationError('profiles array is required and must not be empty', {
      profiles: 'missing',
    });
  }

  // Build profile inputs, ensuring founderId is set on each
  const profileInputs = body.profiles.map((p) => ({
    ...p,
    founderId,
    isActive: p.isActive ?? true,
  })) as Parameters<typeof replaceICPSet>[1];

  try {
    // Req 7.2: Replace existing ICP_Set with the new one
    const savedSet = await replaceICPSet(founderId, profileInputs);

    // Req 7.5: Re-score all active leads against the new ICP_Set
    await rescoreLeads(founderId, savedSet.profiles);

    return NextResponse.json(savedSet);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to confirm ICP set';
    if (message.startsWith('Invalid ICP profile:')) {
      return validationError(message);
    }
    return dbWriteError(message);
  }
}

/**
 * Re-score all non-deleted leads for a founder against the new ICP profiles.
 * Each lead is scored against every active profile and associated with the
 * best-matching one (highest score).
 * Req 7.4: Leads are retained — only scores and icp_profile_id are updated.
 * Req 7.5: Re-scoring triggered after ICP_Set replacement.
 */
async function rescoreLeads(founderId: string, profiles: ICPProfile[]): Promise<void> {
  if (profiles.length === 0) return;

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

  for (const row of leadsResult.rows) {
    let bestScore = -1;
    let bestBreakdown: ScoreBreakdownV2 | null = null;
    let bestProfileId: string | null = null;

    // Score against each profile, keep the best
    for (const profile of profiles) {
      const result = calculateLeadScoreV2({
        lead: {
          role: row.role,
          company: row.company,
          industry: row.industry ?? undefined,
          geography: row.geography ?? undefined,
          enrichmentData: row.enrichment_data ?? undefined,
        },
        icpProfile: profile,
      });

      if (result.totalScore > bestScore) {
        bestScore = result.totalScore;
        bestBreakdown = result.breakdown;
        bestProfileId = profile.id;
      }
    }

    if (bestBreakdown && bestProfileId) {
      await query(
        `UPDATE lead
         SET lead_score = $1, score_breakdown = $2, icp_profile_id = $3, updated_at = NOW()
         WHERE id = $4`,
        [bestScore, JSON.stringify(bestBreakdown), bestProfileId, row.id],
      );
    }
  }
}
