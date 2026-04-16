import { dbWriteError, throttleError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { recordOutreach, type RecordOutreachInput } from '@/services/outreachService';
import { canRecordOutreach, getThrottleStatus } from '@/services/throttleService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/outreach
 * Record an outreach action. Throttle-checked before recording.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 5.1, 5.3, 5.5
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Omit<RecordOutreachInput, 'founderId'> & { founderId?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
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
    const allowed = await canRecordOutreach(session.founderId, body.channel);
    if (!allowed) {
      const status = await getThrottleStatus(session.founderId, body.channel);
      return throttleError(
        `Daily ${body.channel} outreach limit reached (${status.limit}). Try again tomorrow.`,
        {
          channel: body.channel,
          limit: String(status.limit),
          used: String(status.used),
        },
      );
    }

    const record = await recordOutreach({
      ...body,
      founderId: session.founderId,
    } as RecordOutreachInput);
    return NextResponse.json(record, { status: 201 });
  } catch {
    return dbWriteError('Failed to record outreach');
  }
}
