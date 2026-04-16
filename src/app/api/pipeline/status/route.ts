import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getPipelineStatus } from '@/services/pipelineOrchestratorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/status?founderId=<uuid>
 * Get current pipeline status: state, last run, next scheduled run.
 *
 * Requirements: 1.6
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const status = await getPipelineStatus(founderId);
    return NextResponse.json(status);
  } catch {
    return dbWriteError('Failed to retrieve pipeline status');
  }
}
