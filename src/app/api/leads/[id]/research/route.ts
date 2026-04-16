import { dbWriteError } from '@/lib/apiErrors';
import { getLeadById } from '@/services/leadService';
import { getResearchProfile } from '@/services/prospectResearcherService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/leads/:id/research
 * Fetch a lead's Research Profile.
 *
 * Requirements: 2.8
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const lead = await getLeadById(id);
    if (!lead) {
      return NextResponse.json(null, { status: 404 });
    }

    const profile = await getResearchProfile(id);
    if (!profile) {
      return NextResponse.json(null, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch {
    return dbWriteError('Failed to retrieve research profile');
  }
}
