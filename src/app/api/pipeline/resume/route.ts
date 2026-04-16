import { validationError } from '@/lib/apiErrors';
import { getPipelineState, resumePipeline } from '@/services/pipelineOrchestratorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/pipeline/resume
 * Resume the pipeline orchestrator.
 * Begins executing pipeline runs from the next scheduled interval.
 *
 * Requirements: 1.7
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const founderId = body.founderId;
  if (!founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  await resumePipeline(founderId);
  const state = await getPipelineState(founderId);
  return NextResponse.json({ state, message: 'Pipeline resumed' });
}
