import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { discoverAndEnrichLeads } from '@/services/enrichmentService';
import { NextResponse } from 'next/server';

/**
 * POST /api/leads/discover
 * Triggers lead discovery from public sources matching the founder's active ICP.
 * Discovers leads, creates them with scoring, enriches them, and re-scores.
 *
 * Requirements: 2.1, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const leads = await discoverAndEnrichLeads(session.founderId);
    return NextResponse.json(leads, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to discover leads';
    if (message === 'No ICP defined for this founder') {
      return validationError(message, { icp: 'missing' });
    }
    return dbWriteError(message);
  }
}
