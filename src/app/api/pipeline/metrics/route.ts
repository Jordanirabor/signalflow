import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getDailyMetrics } from '@/services/pipelineMetricsService';
import { getPipelineStatus } from '@/services/pipelineOrchestratorService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/metrics?founderId=<uuid>
 * Daily pipeline metrics: prospects discovered, messages sent, replies received,
 * meetings booked, reply rate.
 *
 * Requirements: 11.1, 11.2
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const pipelineStatus = await getPipelineStatus(founderId);
    const metrics = await getDailyMetrics(founderId, pipelineStatus);
    return NextResponse.json(metrics);
  } catch {
    return dbWriteError('Failed to retrieve pipeline metrics');
  }
}
