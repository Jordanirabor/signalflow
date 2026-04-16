import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { executePipelineRun } from '@/services/pipelineOrchestratorService';
import { NextResponse } from 'next/server';

/**
 * POST /api/pipeline/run
 * Manually trigger a pipeline run. Works regardless of pipeline state.
 *
 * Requirements: 1.2
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const run = await executePipelineRun(session.founderId);
    return NextResponse.json(run);
  } catch {
    return dbWriteError('Failed to execute pipeline run');
  }
}
