import { validationError } from '@/lib/apiErrors';
import { getPipelineState, pausePipeline } from '@/services/pipelineOrchestratorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/pipeline/pause
 * Pause the pipeline orchestrator.
 * Stops scheduling new runs; any in-progress run completes before halting.
 *
 * Requirements: 1.5
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const founderId = body.founderId;
  if (!founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  await pausePipeline(founderId);
  const state = await getPipelineState(founderId);
  return NextResponse.json({ state, message: 'Pipeline paused' });
}
