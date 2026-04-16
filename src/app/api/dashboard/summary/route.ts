import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getWeeklySummary } from '@/services/dashboardService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/dashboard/summary?founderId=...
 * Returns the weekly dashboard summary with metrics, upcoming meetings,
 * high-priority suggestions, and low meeting prompt.
 *
 * Requirements: 8.1, 8.2, 8.4, 8.5, 8.6
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');

  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const summary = await getWeeklySummary(founderId);
    return NextResponse.json(summary);
  } catch {
    return dbWriteError('Failed to retrieve dashboard summary');
  }
}
