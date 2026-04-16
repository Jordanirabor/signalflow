import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getRecentRuns } from '@/services/pipelineOrchestratorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/runs?founderId=<uuid>&limit=<number>
 * List recent pipeline runs for a founder.
 *
 * Requirements: 1.3
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 100) : 20;

  try {
    const runs = await getRecentRuns(founderId, limit);
    return NextResponse.json(runs);
  } catch {
    return dbWriteError('Failed to retrieve pipeline runs');
  }
}
