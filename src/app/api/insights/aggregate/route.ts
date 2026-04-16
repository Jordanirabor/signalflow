import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getAggregatedInsights } from '@/services/insightService';
import { NextResponse } from 'next/server';

/**
 * GET /api/insights/aggregate
 * Get aggregated insights: top pain points, objections, and feature requests
 * sorted by frequency.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 7.4
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const insights = await getAggregatedInsights(session.founderId);
    return NextResponse.json(insights);
  } catch {
    return dbWriteError('Failed to retrieve aggregated insights');
  }
}
