import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getRecentRuns } from '@/services/pipelineOrchestratorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/runs?limit=<number>
 * List recent pipeline runs for a founder.
 *
 * Requirements: 1.3
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 100) : 20;

  try {
    const runs = await getRecentRuns(session.founderId, limit);
    return NextResponse.json(runs);
  } catch {
    return dbWriteError('Failed to retrieve pipeline runs');
  }
}
