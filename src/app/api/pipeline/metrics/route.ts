import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getDailyMetrics } from '@/services/pipelineMetricsService';
import { getPipelineStatus } from '@/services/pipelineOrchestratorService';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/metrics
 * Daily pipeline metrics: prospects discovered, messages sent, replies received,
 * meetings booked, reply rate.
 *
 * Requirements: 11.1, 11.2
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const founderId = session.founderId;
  const { searchParams } = new URL(request.url);
  const icpProfileId = searchParams.get('icpProfileId') ?? undefined;

  try {
    const pipelineStatus = await getPipelineStatus(founderId);
    const metrics = await getDailyMetrics(founderId, pipelineStatus, icpProfileId);
    return NextResponse.json(metrics);
  } catch {
    return dbWriteError('Failed to retrieve pipeline metrics');
  }
}
