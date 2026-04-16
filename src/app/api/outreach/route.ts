import { dbWriteError, throttleError, validationError } from '@/lib/apiErrors';
import { recordOutreach, type RecordOutreachInput } from '@/services/outreachService';
import { canRecordOutreach, getThrottleStatus } from '@/services/throttleService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/outreach
 * Record an outreach action. Throttle-checked before recording.
 *
 * Requirements: 5.1, 5.3, 5.5
 */
export async function POST(request: NextRequest) {
  let body: RecordOutreachInput;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }
  if (!body.leadId) {
    return validationError('leadId is required', { leadId: 'missing' });
  }
  if (!body.channel || (body.channel !== 'email' && body.channel !== 'dm')) {
    return validationError('channel must be "email" or "dm"', { channel: 'invalid' });
  }
  if (!body.messageContent || body.messageContent.trim() === '') {
    return validationError('messageContent is required', { messageContent: 'missing' });
  }

  try {
    // Throttle check
    const allowed = await canRecordOutreach(body.founderId, body.channel);
    if (!allowed) {
      const status = await getThrottleStatus(body.founderId, body.channel);
      return throttleError(
        `Daily ${body.channel} outreach limit reached (${status.limit}). Try again tomorrow.`,
        {
          channel: body.channel,
          limit: String(status.limit),
          used: String(status.used),
        },
      );
    }

    const record = await recordOutreach(body);
    return NextResponse.json(record, { status: 201 });
  } catch {
    return dbWriteError('Failed to record outreach');
  }
}
