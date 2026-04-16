import { dbWriteError, validationError } from '@/lib/apiErrors';
import { discoverAndEnrichLeads } from '@/services/enrichmentService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/leads/discover
 * Triggers lead discovery from public sources matching the founder's active ICP.
 * Discovers leads, creates them with scoring, enriches them, and re-scores.
 *
 * Body: { founderId: string }
 *
 * Requirements: 2.1, 2.3, 2.4, 3.1
 */
export async function POST(request: NextRequest) {
  let body: { founderId?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.founderId || body.founderId.trim() === '') {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  try {
    const leads = await discoverAndEnrichLeads(body.founderId);
    return NextResponse.json(leads, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to discover leads';
    if (message === 'No ICP defined for this founder') {
      return validationError(message, { icp: 'missing' });
    }
    return dbWriteError(message);
  }
}
