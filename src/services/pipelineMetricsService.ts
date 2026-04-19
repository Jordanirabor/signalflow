import { query } from '@/lib/db';
import type {
  CalendarEvent,
  ConversationMessage,
  ConversationThread,
  ManualReviewItem,
  PipelineMetrics,
  PipelineRun,
  PipelineStatus,
} from '@/types';

// ─── Pure Functions (exported for property testing) ───

/**
 * Compute daily pipeline metrics from a set of pipeline run records.
 * Pure function — no DB access.
 *
 * Property 20: Pipeline metrics computation
 * Validates: Requirements 11.2
 */
export function computeDailyMetrics(
  runs: PipelineRun[],
  pipelineStatus: PipelineStatus,
): PipelineMetrics {
  const prospectsDiscoveredToday = runs.reduce((sum, r) => sum + r.prospectsDiscovered, 0);
  const messagesSentToday = runs.reduce((sum, r) => sum + r.messagesSent, 0);
  const repliesReceivedToday = runs.reduce((sum, r) => sum + r.repliesProcessed, 0);
  const meetingsBookedToday = runs.reduce((sum, r) => sum + r.meetingsBooked, 0);
  const replyRatePercent =
    messagesSentToday > 0 ? (repliesReceivedToday / messagesSentToday) * 100 : 0;

  return {
    prospectsDiscoveredToday,
    messagesSentToday,
    repliesReceivedToday,
    meetingsBookedToday,
    replyRatePercent,
    pipelineStatus,
  };
}

/**
 * Merge outbound and inbound messages into a single chronologically-ordered thread.
 * Pure function — no DB access.
 *
 * Property 21: Conversation thread chronological order
 * Validates: Requirements 11.3
 */
export function mergeConversationThread(
  outbound: ConversationMessage[],
  inbound: ConversationMessage[],
): ConversationMessage[] {
  return [...outbound, ...inbound].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

// ─── Database-backed query functions ───

/**
 * Fetch today's pipeline metrics for a founder.
 * Counts leads and outreach directly from the source tables for real-time accuracy,
 * rather than relying solely on pipeline_run summary records.
 */
export async function getDailyMetrics(
  founderId: string,
  pipelineStatus: PipelineStatus,
  icpProfileId?: string,
): Promise<PipelineMetrics> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  // Count leads discovered today directly from the lead table
  const leadsParams: unknown[] = [founderId, todayISO];
  let leadsQuery =
    'SELECT COUNT(*) AS count FROM lead' +
    ' WHERE founder_id = $1 AND is_deleted = false AND created_at >= $2';
  if (icpProfileId) {
    leadsParams.push(icpProfileId);
    leadsQuery += ' AND icp_profile_id = $' + leadsParams.length;
  }
  const leadsResult = await query<{ count: string }>(leadsQuery, leadsParams);
  const prospectsDiscoveredToday = parseInt(leadsResult.rows[0]?.count ?? '0', 10);

  // Count messages sent today from outreach_record
  const messagesParams: unknown[] = [founderId, todayISO];
  let messagesQuery: string;
  if (icpProfileId) {
    messagesParams.push(icpProfileId);
    messagesQuery =
      'SELECT COUNT(*) AS count FROM outreach_record' +
      ' JOIN lead ON outreach_record.lead_id = lead.id' +
      ' WHERE outreach_record.founder_id = $1 AND outreach_record.outreach_date >= $2' +
      ' AND lead.icp_profile_id = $' +
      messagesParams.length;
  } else {
    messagesQuery =
      'SELECT COUNT(*) AS count FROM outreach_record' +
      ' WHERE founder_id = $1 AND outreach_date >= $2';
  }
  const messagesResult = await query<{ count: string }>(messagesQuery, messagesParams);
  const messagesSentToday = parseInt(messagesResult.rows[0]?.count ?? '0', 10);

  // Count replies received today from incoming_reply
  const repliesParams: unknown[] = [founderId, todayISO];
  let repliesQuery: string;
  if (icpProfileId) {
    repliesParams.push(icpProfileId);
    repliesQuery =
      'SELECT COUNT(*) AS count FROM incoming_reply' +
      ' JOIN lead ON incoming_reply.lead_id = lead.id' +
      ' WHERE incoming_reply.founder_id = $1 AND incoming_reply.received_at >= $2' +
      ' AND lead.icp_profile_id = $' +
      repliesParams.length;
  } else {
    repliesQuery =
      'SELECT COUNT(*) AS count FROM incoming_reply' +
      ' WHERE founder_id = $1 AND received_at >= $2';
  }
  const repliesResult = await query<{ count: string }>(repliesQuery, repliesParams);
  const repliesReceivedToday = parseInt(repliesResult.rows[0]?.count ?? '0', 10);

  // Count meetings booked today from calendar_event
  const meetingsParams: unknown[] = [founderId, todayISO];
  let meetingsQuery: string;
  if (icpProfileId) {
    meetingsParams.push(icpProfileId);
    meetingsQuery =
      'SELECT COUNT(*) AS count FROM calendar_event' +
      ' JOIN lead ON calendar_event.lead_id = lead.id' +
      ' WHERE calendar_event.founder_id = $1 AND calendar_event.created_at >= $2' +
      ' AND lead.icp_profile_id = $' +
      meetingsParams.length;
  } else {
    meetingsQuery =
      'SELECT COUNT(*) AS count FROM calendar_event' +
      ' WHERE founder_id = $1 AND created_at >= $2';
  }
  const meetingsResult = await query<{ count: string }>(meetingsQuery, meetingsParams);
  const meetingsBookedToday = parseInt(meetingsResult.rows[0]?.count ?? '0', 10);

  const replyRatePercent =
    messagesSentToday > 0 ? (repliesReceivedToday / messagesSentToday) * 100 : 0;

  return {
    prospectsDiscoveredToday,
    messagesSentToday,
    repliesReceivedToday,
    meetingsBookedToday,
    replyRatePercent,
    pipelineStatus,
  };
}

/**
 * Fetch all conversation threads for a founder.
 */
export async function getConversationThreads(founderId: string): Promise<ConversationThread[]> {
  const leads = await query(
    `SELECT DISTINCT l.id, l.name, l.company, l.email
     FROM lead l
     INNER JOIN outreach_record o ON o.lead_id = l.id
     WHERE l.founder_id = $1 AND l.is_deleted = false
     ORDER BY l.name`,
    [founderId],
  );

  const threads: ConversationThread[] = [];

  for (const lead of leads.rows) {
    const messages = await getConversationThread(founderId, lead.id);
    threads.push({
      leadId: lead.id,
      leadName: lead.name,
      company: lead.company,
      email: lead.email ?? undefined,
      messages,
    });
  }

  return threads;
}

/**
 * Fetch a single conversation thread for a specific lead.
 */
export async function getConversationThread(
  founderId: string,
  leadId: string,
): Promise<ConversationMessage[]> {
  // Outbound messages
  const outboundResult = await query(
    `SELECT id, message_content, outreach_date, channel, is_follow_up
     FROM outreach_record
     WHERE founder_id = $1 AND lead_id = $2
     ORDER BY outreach_date ASC`,
    [founderId, leadId],
  );

  const outbound: ConversationMessage[] = outboundResult.rows.map((row) => ({
    id: row.id,
    direction: 'outbound' as const,
    content: row.message_content,
    timestamp: new Date(row.outreach_date),
    channel: row.channel ?? undefined,
    isFollowUp: row.is_follow_up ?? false,
  }));

  // Inbound messages
  const inboundResult = await query(
    `SELECT id, body_text, received_at, classification_result, classification_confidence
     FROM incoming_reply
     WHERE founder_id = $1 AND lead_id = $2
     ORDER BY received_at ASC`,
    [founderId, leadId],
  );

  const inbound: ConversationMessage[] = inboundResult.rows.map((row) => ({
    id: row.id,
    direction: 'inbound' as const,
    content: row.body_text,
    timestamp: new Date(row.received_at),
    classification: row.classification_result ?? undefined,
    confidence:
      row.classification_confidence != null ? Number(row.classification_confidence) : undefined,
  }));

  return mergeConversationThread(outbound, inbound);
}

/**
 * Fetch manual review queue — low-confidence classifications.
 */
export async function getManualReviewQueue(founderId: string): Promise<ManualReviewItem[]> {
  const result = await query(
    `SELECT ir.id AS reply_id, l.name AS lead_name, l.company,
            ir.body_text, ir.classification_result, ir.classification_confidence,
            ir.received_at
     FROM incoming_reply ir
     INNER JOIN lead l ON l.id = ir.lead_id
     WHERE ir.founder_id = $1
       AND ir.requires_manual_review = true
       AND ir.processed_at IS NULL
     ORDER BY ir.received_at ASC`,
    [founderId],
  );

  return result.rows.map((row) => ({
    replyId: row.reply_id,
    leadName: row.lead_name,
    company: row.company,
    replyText: row.body_text,
    suggestedClassification: row.classification_result ?? 'question',
    confidence: Number(row.classification_confidence ?? 0),
    receivedAt: new Date(row.received_at),
  }));
}

/**
 * Resolve a manual review item by confirming or overriding the classification.
 */
export async function resolveManualReview(replyId: string, classification: string): Promise<void> {
  await query(
    `UPDATE incoming_reply
     SET classification_result = $1,
         requires_manual_review = false,
         processed_at = NOW()
     WHERE id = $2`,
    [classification, replyId],
  );
}

/**
 * Fetch calendar events for the current week.
 */
export async function getWeekCalendarEvents(founderId: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const result = await query(
    `SELECT id, calendar_event_id, founder_id, lead_id, title, description,
            start_time, end_time, attendee_email, created_at
     FROM calendar_event
     WHERE founder_id = $1
       AND start_time >= $2
       AND start_time <= $3
     ORDER BY start_time ASC`,
    [founderId, monday.toISOString(), sunday.toISOString()],
  );

  return result.rows.map((row) => ({
    id: row.id,
    calendarEventId: row.calendar_event_id,
    founderId: row.founder_id,
    leadId: row.lead_id,
    title: row.title,
    description: row.description,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    attendeeEmail: row.attendee_email,
    createdAt: new Date(row.created_at),
  }));
}
