import { getSession } from '@/lib/auth';
import { getPipelineState, pausePipeline } from '@/services/pipelineOrchestratorService';
import { NextResponse } from 'next/server';

/**
 * POST /api/pipeline/pause
 * Pause the pipeline orchestrator.
 * Stops scheduling new runs; any in-progress run completes before halting.
 *
 * Requirements: 1.5
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await pausePipeline(session.founderId);
  const state = await getPipelineState(session.founderId);
  return NextResponse.json({ state, message: 'Pipeline paused' });
}
