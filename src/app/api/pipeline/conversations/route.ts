import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getConversationThreads } from '@/services/pipelineMetricsService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/conversations?founderId=<uuid>
 * List all conversation threads for a founder.
 *
 * Requirements: 11.3
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const threads = await getConversationThreads(founderId);
    return NextResponse.json(threads);
  } catch {
    return dbWriteError('Failed to retrieve conversation threads');
  }
}
