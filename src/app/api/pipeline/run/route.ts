import { dbWriteError, validationError } from '@/lib/apiErrors';
import { executePipelineRun } from '@/services/pipelineOrchestratorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/pipeline/run
 * Manually trigger a pipeline run. Works regardless of pipeline state.
 *
 * Requirements: 1.2
 */
export async function POST(request: NextRequest) {
  let body: { founderId?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  try {
    const run = await executePipelineRun(body.founderId);
    return NextResponse.json(run);
  } catch {
    return dbWriteError('Failed to execute pipeline run');
  }
}
