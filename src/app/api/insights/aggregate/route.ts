import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getAggregatedInsights } from '@/services/insightService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/insights/aggregate?founderId=...
 * Get aggregated insights: top pain points, objections, and feature requests
 * sorted by frequency.
 *
 * Requirements: 7.4
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');

  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const insights = await getAggregatedInsights(founderId);
    return NextResponse.json(insights);
  } catch {
    return dbWriteError('Failed to retrieve aggregated insights');
  }
}
