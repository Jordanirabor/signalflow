/**
 * IMAP Poll Scheduler — per-minute cron that checks whether any founder's
 * IMAP poll is due, then triggers polling and downstream processing.
 *
 * Follows the same node-cron pattern as pipelineSchedulerService.ts.
 *
 * Requirements: 4.1, 4.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import { query } from '@/lib/db';
import { pollImapInbox } from '@/services/imapMonitorService';
import {
  createIncomingReplyRecord,
  matchIncomingMessage,
} from '@/services/messageThreadingService';
import { classifyReply } from '@/services/responseClassifierService';
import * as cron from 'node-cron';

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

// ---------------------------------------------------------------------------
// Row types for database queries
// ---------------------------------------------------------------------------

interface ActiveSmtpImapFounderRow {
  founder_id: string;
}

interface PollDueRow {
  last_poll_at: Date | null;
  poll_interval_minutes: number;
}

// ---------------------------------------------------------------------------
// startImapPollScheduler
// ---------------------------------------------------------------------------

/**
 * Start the IMAP poll scheduler.
 * Uses node-cron to check every minute whether any founder's IMAP poll is due.
 */
export function startImapPollScheduler(): void {
  if (cronTask) return; // Already started

  cronTask = cron.schedule('* * * * *', async () => {
    if (isRunning) return; // Skip if a run is already in progress

    try {
      isRunning = true;

      // 1. Query all founders with active smtp_imap provider
      const foundersResult = await query<ActiveSmtpImapFounderRow>(
        `SELECT ec.founder_id
         FROM email_connection ec
         WHERE ec.active_provider = 'smtp_imap'
           AND ec.is_active = true`,
      );

      for (const row of foundersResult.rows) {
        const founderId = row.founder_id;

        try {
          await processFounderPoll(founderId);
        } catch (err) {
          console.error(`[ImapPollScheduler] Error processing founder ${founderId}:`, err);
        }
      }
    } catch (err) {
      console.error('[ImapPollScheduler] Error during scheduled run:', err);
    } finally {
      isRunning = false;
    }
  });
}

// ---------------------------------------------------------------------------
// stopImapPollScheduler
// ---------------------------------------------------------------------------

/**
 * Stop the IMAP poll scheduler.
 */
export function stopImapPollScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}

// ---------------------------------------------------------------------------
// Internal: check if poll is due and process messages for a single founder
// ---------------------------------------------------------------------------

async function processFounderPoll(founderId: string): Promise<void> {
  // 2. Check if a poll is due by comparing last_poll_at with poll_interval_minutes
  const pollDueResult = await query<PollDueRow>(
    `SELECT ips.last_poll_at, epc.poll_interval_minutes
     FROM email_provider_config epc
     LEFT JOIN imap_polling_state ips
       ON ips.founder_id = epc.founder_id
       AND ips.folder_name = 'INBOX'
     WHERE epc.founder_id = $1
       AND epc.is_active = true`,
    [founderId],
  );

  if (pollDueResult.rows.length === 0) return;

  const { last_poll_at, poll_interval_minutes } = pollDueResult.rows[0];
  const now = new Date();

  if (last_poll_at) {
    const elapsedMs = now.getTime() - new Date(last_poll_at).getTime();
    const intervalMs = poll_interval_minutes * 60 * 1000;
    if (elapsedMs < intervalMs) return; // Not due yet
  }

  // 3. Poll is due — trigger IMAP inbox poll
  const messages = await pollImapInbox(founderId);

  // 4–5. Process each new message through threading → classification → CRM
  for (const message of messages) {
    try {
      const match = await matchIncomingMessage(
        founderId,
        message.inReplyTo,
        message.references,
        message.from,
      );

      if (match) {
        // Create the incoming reply record
        const reply = await createIncomingReplyRecord(founderId, match, message);

        // Classify the reply
        await classifyReply(reply.id, message.bodyText);
      }
    } catch (err) {
      console.error(
        `[ImapPollScheduler] Error processing message UID ${message.uid} for founder ${founderId}:`,
        err,
      );
    }
  }
}
