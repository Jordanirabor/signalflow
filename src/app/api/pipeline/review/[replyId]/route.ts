import { dbWriteError, validationError } from '@/lib/apiErrors';
import { resolveManualReview } from '@/services/pipelineMetricsService';
import type { ResponseClassification } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

const VALID_CLASSIFICATIONS: ResponseClassification[] = [
  'interested',
  'not_interested',
  'objection',
  'question',
  'out_of_office',
];

/**
 * POST /api/pipeline/review/[replyId]
 * Resolve a manual review item by confirming or overriding the classification.
 *
 * Body: { classification: ResponseClassification }
 *
 * Requirements: 11.6
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ replyId: string }> },
) {
  const { replyId } = await params;

  let body: { classification?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  const { classification } = body;
  if (
    !classification ||
    !VALID_CLASSIFICATIONS.includes(classification as ResponseClassification)
  ) {
    return validationError(
      'classification is required and must be one of: interested, not_interested, objection, question, out_of_office',
      {
        classification: 'invalid',
      },
    );
  }

  try {
    await resolveManualReview(replyId, classification);
    return NextResponse.json({ resolved: true, replyId, classification });
  } catch {
    return dbWriteError('Failed to resolve manual review item');
  }
}
