import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getManualReviewQueue } from '@/services/pipelineMetricsService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/review?founderId=<uuid>
 * Manual review queue — low-confidence classifications.
 *
 * Requirements: 11.6
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const items = await getManualReviewQueue(founderId);
    return NextResponse.json(items);
  } catch {
    return dbWriteError('Failed to retrieve manual review queue');
  }
}
