import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getWeeklySummary } from '@/services/dashboardService';
import { NextResponse } from 'next/server';

/**
 * GET /api/dashboard/summary
 * Returns the weekly dashboard summary with metrics, upcoming meetings,
 * high-priority suggestions, and low meeting prompt.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 8.1, 8.2, 8.4, 8.5, 8.6
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await getWeeklySummary(session.founderId);
    return NextResponse.json(summary);
  } catch {
    return dbWriteError('Failed to retrieve dashboard summary');
  }
}
