import { dbWriteError } from '@/lib/apiErrors';
import { getLeadById } from '@/services/leadService';
import { researchProspect } from '@/services/prospectResearcherService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/leads/:id/research/refresh
 * Manually trigger a research refresh for a lead.
 *
 * Requirements: 2.8
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const lead = await getLeadById(id);
    if (!lead) {
      return NextResponse.json(null, { status: 404 });
    }

    const profile = await researchProspect(lead);
    return NextResponse.json(profile);
  } catch {
    return dbWriteError('Failed to refresh research profile');
  }
}
