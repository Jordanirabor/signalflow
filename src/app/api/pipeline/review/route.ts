import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getManualReviewQueue } from '@/services/pipelineMetricsService';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/review
 * Manual review queue — low-confidence classifications.
 *
 * Requirements: 11.6
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const items = await getManualReviewQueue(session.founderId);
    return NextResponse.json(items);
  } catch {
    return dbWriteError('Failed to retrieve manual review queue');
  }
}
