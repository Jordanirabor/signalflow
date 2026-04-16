import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { executePipelineRun } from '@/services/pipelineOrchestratorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/pipeline/run
 * Manually trigger a pipeline run scoped to a specific project.
 * Requires projectId in the request body.
 *
 * Requirements: 1.2, 5.1, 5.5
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  const projectId = body.projectId?.trim();
  if (!projectId) {
    return validationError('projectId is required', { projectId: 'missing' });
  }

  try {
    const run = await executePipelineRun(session.founderId, projectId);
    return NextResponse.json(run);
  } catch {
    return dbWriteError('Failed to execute pipeline run');
  }
}
