import { dbWriteError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getConversationThreads } from '@/services/pipelineMetricsService';
import { NextResponse } from 'next/server';

/**
 * GET /api/pipeline/conversations
 * List all conversation threads for a founder.
 *
 * Requirements: 11.3
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const threads = await getConversationThreads(session.founderId);
    return NextResponse.json(threads);
  } catch {
    return dbWriteError('Failed to retrieve conversation threads');
  }
}
