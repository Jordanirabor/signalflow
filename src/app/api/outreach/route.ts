import { dbWriteError, throttleError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { send as transportSend } from '@/services/emailTransportService';
import { recordOutreach, type RecordOutreachInput } from '@/services/outreachService';
import { canRecordOutreach, getThrottleStatus } from '@/services/throttleService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/outreach
 * Record an outreach action. For email channel, actually sends via Gmail.
 * Throttle-checked before recording.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 5.1, 5.3, 5.5
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Omit<RecordOutreachInput, 'founderId'> & { founderId?: string; subjectLine?: string };
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

    // For email channel, actually send via Gmail
    let gmailThreadId: string | undefined;
    let gmailMessageId: string | undefined;

    if (body.channel === 'email') {
      // Look up the lead's email
      const leadResult = await query<{
        email: string | null;
        name: string;
        company: string | null;
      }>(
        `SELECT email, name, company FROM lead WHERE id = $1 AND founder_id = $2 AND is_deleted = false`,
        [body.leadId, session.founderId],
      );

      if (leadResult.rows.length === 0) {
        return validationError('Lead not found', { leadId: 'not_found' });
      }

      const lead = leadResult.rows[0];
      if (!lead.email) {
        return validationError(
          'Lead has no email address. Connect an email or add one to the lead first.',
          {
            email: 'missing',
          },
        );
      }

      try {
        const sendResult = await transportSend({
          founderId: session.founderId,
          to: lead.email,
          subject:
            body.subjectLine ||
            `${lead.name.split(/\s+/)[0]} + ${lead.company || 'quick question'}`,
          body: body.messageContent,
        });
        gmailThreadId = sendResult.threadId ?? undefined;
        gmailMessageId = sendResult.messageId;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message === 'EMAIL_NOT_CONNECTED' ||
          message === 'PROVIDER_NOT_CONFIGURED' ||
          message === 'PROVIDER_NOT_VERIFIED'
        ) {
          return validationError(
            'Email provider is not connected. Connect your email account in Autopilot settings first.',
            {
              email: 'not_connected',
            },
          );
        }
        return dbWriteError(`Failed to send email: ${message}`);
      }
    }

    const record = await recordOutreach({
      ...body,
      founderId: session.founderId,
    } as RecordOutreachInput);

    // Store Gmail IDs on the outreach record if email was sent
    if (gmailThreadId && gmailMessageId) {
      await query(
        `UPDATE outreach_record SET gmail_thread_id = $1, gmail_message_id = $2 WHERE id = $3`,
        [gmailThreadId, gmailMessageId, record.id],
      );
    }

    return NextResponse.json(
      { ...record, emailSent: body.channel === 'email' && !!gmailMessageId },
      { status: 201 },
    );
  } catch {
    return dbWriteError('Failed to record outreach');
  }
}
