import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getPipeline, isValidCRMStatus, type PipelineFilters } from '@/services/crmService';
import type { CRMStatus } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/crm/pipeline?status=<CRMStatus>&minScore=<n>&maxScore=<n>&lastActivityAfter=<ISO date>
 * Get all leads grouped by CRM status with aggregate counts.
 * Supports filtering by status, score range, and last activity date.
 *
 * Requirements: 6.1, 6.3, 6.5
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const founderId = session.founderId;

  const filters: PipelineFilters = { founderId };

  // Optional status filter
  const statusParam = searchParams.get('status');
  if (statusParam) {
    if (!isValidCRMStatus(statusParam)) {
      return validationError(
        `Invalid status: ${statusParam}. Must be one of: New, Contacted, Replied, Booked, Closed`,
        { status: 'invalid' },
      );
    }
    filters.status = statusParam as CRMStatus;
  }

  // Optional minScore filter
  const minScoreParam = searchParams.get('minScore');
  if (minScoreParam !== null) {
    const minScore = Number(minScoreParam);
    if (isNaN(minScore)) {
      return validationError('minScore must be a number', { minScore: 'invalid' });
    }
    filters.minScore = minScore;
  }

  // Optional maxScore filter
  const maxScoreParam = searchParams.get('maxScore');
  if (maxScoreParam !== null) {
    const maxScore = Number(maxScoreParam);
    if (isNaN(maxScore)) {
      return validationError('maxScore must be a number', { maxScore: 'invalid' });
    }
    filters.maxScore = maxScore;
  }

  // Optional lastActivityAfter filter
  const lastActivityAfterParam = searchParams.get('lastActivityAfter');
  if (lastActivityAfterParam) {
    const date = new Date(lastActivityAfterParam);
    if (isNaN(date.getTime())) {
      return validationError('lastActivityAfter must be a valid ISO date', {
        lastActivityAfter: 'invalid',
      });
    }
    filters.lastActivityAfter = lastActivityAfterParam;
  }

  try {
    const pipeline = await getPipeline(filters);
    return NextResponse.json(pipeline);
  } catch {
    return dbWriteError('Failed to retrieve pipeline data');
  }
}
