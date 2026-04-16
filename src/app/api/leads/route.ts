import { dbWriteError, duplicateError, validationError } from '@/lib/apiErrors';
import { getICP } from '@/services/icpService';
import { createLead, findDuplicate, listLeads, type CreateLeadInput } from '@/services/leadService';
import { researchProspect } from '@/services/prospectResearcherService';
import { calculateLeadScore } from '@/services/scoringService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/leads
 * Manual lead entry. Scores the lead using the scoring service if an ICP exists.
 * Returns 409 with existing lead ID on duplicate.
 *
 * Requirements: 2.2, 2.5, 10.4
 */
export async function POST(request: NextRequest) {
  let body: CreateLeadInput;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }
  if (!body.name || body.name.trim() === '') {
    return validationError('name is required', { name: 'missing' });
  }
  if (!body.role || body.role.trim() === '') {
    return validationError('role is required', { role: 'missing' });
  }
  if (!body.company || body.company.trim() === '') {
    return validationError('company is required', { company: 'missing' });
  }

  try {
    // Proactive duplicate check
    const existing = await findDuplicate(body.founderId, body.name, body.company);
    if (existing) {
      return duplicateError('A lead with this name and company already exists', {
        existingLeadId: existing.id,
      });
    }

    // Score the lead if an ICP exists
    let score = 0;
    let scoreBreakdown = { icpMatch: 0, roleRelevance: 0, intentSignals: 0 };

    const icp = await getICP(body.founderId);
    if (icp) {
      const result = calculateLeadScore({
        lead: {
          role: body.role,
          company: body.company,
          industry: body.industry,
          geography: body.geography,
          enrichmentData: undefined,
        },
        icp,
      });
      score = result.totalScore;
      scoreBreakdown = result.breakdown;
    }

    const lead = await createLead(body, score, scoreBreakdown);

    // Fire-and-forget: trigger async deep research for the new lead
    // The researchProspect function handles setting enrichment status
    // to "researching" during execution and updating on completion.
    researchProspect(lead).catch((err) => {
      console.error(
        `[POST /api/leads] Async research failed for lead "${lead.name}":`,
        err instanceof Error ? err.message : String(err),
      );
    });

    return NextResponse.json(lead, { status: 201 });
  } catch (err: unknown) {
    // Catch unique constraint violation (race condition fallback)
    if (isUniqueViolation(err)) {
      const existing = await findDuplicate(body.founderId, body.name, body.company);
      return duplicateError('A lead with this name and company already exists', {
        existingLeadId: existing?.id ?? 'unknown',
      });
    }
    return dbWriteError('Failed to create lead');
  }
}

/**
 * GET /api/leads?founderId=<uuid>&minScore=<number>&sortBy=<score|created>
 * List leads with optional filters. Default sort: leadScore DESC.
 *
 * Requirements: 2.2, 3.2, 3.3
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', {
      founderId: 'missing',
    });
  }

  const minScoreParam = request.nextUrl.searchParams.get('minScore');
  const sortBy = request.nextUrl.searchParams.get('sortBy') as 'score' | 'created' | null;

  let minScore: number | undefined;
  if (minScoreParam !== null) {
    minScore = Number(minScoreParam);
    if (isNaN(minScore)) {
      return validationError('minScore must be a number', { minScore: 'invalid' });
    }
  }

  try {
    const leads = await listLeads({
      founderId,
      minScore,
      sortBy: sortBy ?? undefined,
    });
    return NextResponse.json(leads);
  } catch {
    return dbWriteError('Failed to retrieve leads');
  }
}

/**
 * Check if a Postgres error is a unique constraint violation (code 23505).
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
