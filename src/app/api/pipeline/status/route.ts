import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getPipelineStatus } from '@/services/pipelineOrchestratorService';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/status
 * Get current pipeline status: state, last run, next scheduled run.
 *
 * Requirements: 1.6
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getPipelineStatus(session.founderId);
    return NextResponse.json(status);
  } catch {
    return dbWriteError('Failed to retrieve pipeline status');
  }
}
