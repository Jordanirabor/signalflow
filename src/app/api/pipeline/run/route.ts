import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { executePipelineRun } from '@/services/pipelineOrchestratorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/pipeline/run
 * Manually trigger a pipeline run scoped to a specific project.
 * Requires projectId in the request body. Optionally accepts icpProfileId
 * to scope discovery to a single ICP profile.
 *
 * Requirements: 1.2, 4.1, 5.1, 5.3, 5.4, 5.5
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string; icpProfileId?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  const projectId = body.projectId?.trim();
  if (!projectId) {
    return validationError('projectId is required', { projectId: 'missing' });
  }

  const icpProfileId = body.icpProfileId?.trim() || undefined;

  try {
    const run = await executePipelineRun(session.founderId, projectId, icpProfileId);
    return NextResponse.json(run);
  } catch (err: unknown) {
    const error = err as { statusCode?: number; errorType?: string; message?: string };
    if (error.statusCode && error.errorType === 'validation_error') {
      return NextResponse.json(
        { error: error.errorType, message: error.message },
        { status: error.statusCode },
      );
    }
    return dbWriteError('Failed to execute pipeline run');
  }
}
