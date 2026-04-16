import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getCallNotes, submitCallNote, type SubmitCallNoteInput } from '@/services/insightService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ leadId: string }> };

/**
 * POST /api/insights/:leadId
 * Submit a call note for a lead. Parses free text, generates tags via LLM,
 * and infers sentiment if empty.
 *
 * Requirements: 7.1, 7.2, 7.5, 7.6
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { leadId } = await context.params;

  if (!leadId) {
    return validationError('leadId is required', { leadId: 'missing' });
  }

  let body: Omit<SubmitCallNoteInput, 'leadId'>;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  if (!body.rawText || body.rawText.trim() === '') {
    return validationError('rawText is required', { rawText: 'missing' });
  }

  if (
    body.sentiment &&
    body.sentiment !== 'positive' &&
    body.sentiment !== 'neutral' &&
    body.sentiment !== 'negative'
  ) {
    return validationError('sentiment must be "positive", "neutral", or "negative"', {
      sentiment: 'invalid',
    });
  }

  try {
    const callNote = await submitCallNote({ ...body, leadId });
    return NextResponse.json(callNote, { status: 201 });
  } catch {
    return dbWriteError('Failed to submit call note');
  }
}

/**
 * GET /api/insights/:leadId
 * Get call notes for a lead in reverse chronological order.
 *
 * Requirements: 7.3
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { leadId } = await context.params;

  if (!leadId) {
    return validationError('leadId is required', { leadId: 'missing' });
  }

  try {
    const notes = await getCallNotes(leadId);
    return NextResponse.json(notes);
  } catch {
    return dbWriteError('Failed to retrieve call notes');
  }
}
