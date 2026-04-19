/**
 * IMAP Reply Processor — processes incoming IMAP messages through the full
 * pipeline: threading → reply record → classification → CRM transitions.
 *
 * Applies CRM status changes based on classification:
 *   - interested     → Replied (reason: reply_interested)
 *   - not_interested → Closed  (reason: not_interested)
 *   - objection/question → Replied (flagged for contextual follow-up)
 *   - out_of_office  → pause outreach, schedule resumption
 *
 * Skips automated CRM action when confidence < 0.7 (flags for manual review).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import { changeLeadStatus } from '@/services/crmService';
import type { ImapMessage } from '@/services/imapMonitorService';
import {
  createIncomingReplyRecord,
  matchIncomingMessage,
} from '@/services/messageThreadingService';
import { classifyReply, shouldFlagForManualReview } from '@/services/responseClassifierService';
import type { ClassificationResult } from '@/types';

/**
 * Process a batch of IMAP messages for a given founder through the full
 * reply-handling pipeline: match → create reply → classify → CRM transition.
 */
export async function processImapReplies(
  founderId: string,
  messages: ImapMessage[],
): Promise<void> {
  for (const message of messages) {
    try {
      // 1. Match the incoming message to an outreach record
      const match = await matchIncomingMessage(
        founderId,
        message.inReplyTo,
        message.references,
        message.from,
      );

      if (!match) {
        // Unmatched messages are already logged by matchIncomingMessage
        continue;
      }

      // 2. Create the IncomingReply record
      const reply = await createIncomingReplyRecord(founderId, match, message);

      // 3. Classify the reply
      const classification = await classifyReply(reply.id, message.bodyText);

      // 4. Check manual review threshold — skip CRM action if confidence < 0.7
      if (shouldFlagForManualReview(classification.confidence)) {
        console.info(
          `[ImapReplyProcessor] Low confidence (${classification.confidence}) for reply ${reply.id} — flagged for manual review, skipping CRM action`,
        );
        continue;
      }

      // 5. Apply CRM transitions based on classification
      await applyCrmTransition(match.leadId, reply.id, classification);
    } catch (err) {
      console.error(
        `[ImapReplyProcessor] Error processing message UID ${message.uid} for founder ${founderId}:`,
        err,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: apply CRM transition based on classification result
// ---------------------------------------------------------------------------

async function applyCrmTransition(
  leadId: string,
  replyId: string,
  classification: ClassificationResult,
): Promise<void> {
  const { classification: category, detectedReturnDate } = classification;

  switch (category) {
    case 'interested': {
      // Req 6.2: transition to Replied with reason reply_interested
      const result = await changeLeadStatus({
        leadId,
        toStatus: 'Replied',
        reason: `reply_interested | replyId:${replyId} | ${classification.reasoning}`,
      });
      if (result) {
        console.info(
          `[ImapReplyProcessor] Lead ${leadId} → Replied (interested), statusChange ${result.statusChange.id}`,
        );
      }
      break;
    }

    case 'not_interested': {
      // Req 6.3: transition to Closed with reason not_interested
      const result = await changeLeadStatus({
        leadId,
        toStatus: 'Closed',
        reason: `not_interested | replyId:${replyId} | ${classification.reasoning}`,
      });
      if (result) {
        console.info(
          `[ImapReplyProcessor] Lead ${leadId} → Closed (not_interested), statusChange ${result.statusChange.id}`,
        );
      }
      break;
    }

    case 'objection':
    case 'question': {
      // Req 6.4: transition to Replied, flag for contextual follow-up
      const result = await changeLeadStatus({
        leadId,
        toStatus: 'Replied',
        reason: `${category}_needs_followup | replyId:${replyId} | ${classification.reasoning}`,
      });
      if (result) {
        console.info(
          `[ImapReplyProcessor] Lead ${leadId} → Replied (${category}), flagged for follow-up, statusChange ${result.statusChange.id}`,
        );
      }
      break;
    }

    case 'out_of_office': {
      // Req 6.5: pause outreach, schedule resumption after detected return date
      const returnInfo = detectedReturnDate
        ? ` | returnDate:${detectedReturnDate.toISOString()}`
        : '';
      const result = await changeLeadStatus({
        leadId,
        toStatus: 'Replied',
        reason: `out_of_office | replyId:${replyId}${returnInfo} | ${classification.reasoning}`,
      });
      if (result) {
        console.info(
          `[ImapReplyProcessor] Lead ${leadId} → Replied (out_of_office), statusChange ${result.statusChange.id}`,
        );
      }
      // TODO: Pause outreach sequence and schedule resumption after detectedReturnDate.
      // The outreach sequence pause/resume infrastructure does not exist yet.
      break;
    }
  }
}
