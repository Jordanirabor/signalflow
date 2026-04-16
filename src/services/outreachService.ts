import { query } from '@/lib/db';
import type { OutreachRecord } from '@/types';

// ---------------------------------------------------------------------------
// Row type returned by Postgres
// ---------------------------------------------------------------------------

interface OutreachRow {
  id: string;
  lead_id: string;
  founder_id: string;
  channel: 'email' | 'dm';
  message_content: string;
  outreach_date: Date;
  is_follow_up: boolean;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface RecordOutreachInput {
  leadId: string;
  founderId: string;
  channel: 'email' | 'dm';
  messageContent: string;
  isFollowUp?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRow(row: OutreachRow): OutreachRecord {
  return {
    id: row.id,
    leadId: row.lead_id,
    founderId: row.founder_id,
    channel: row.channel,
    messageContent: row.message_content,
    outreachDate: row.outreach_date,
    isFollowUp: row.is_follow_up,
    createdAt: row.created_at,
  };
}

const OUTREACH_COLUMNS = `id, lead_id, founder_id, channel, message_content, outreach_date, is_follow_up, created_at`;

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Record a new outreach action. Caller is responsible for throttle checks.
 */
export async function recordOutreach(input: RecordOutreachInput): Promise<OutreachRecord> {
  const result = await query<OutreachRow>(
    `INSERT INTO outreach_record (lead_id, founder_id, channel, message_content, outreach_date, is_follow_up)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     RETURNING ${OUTREACH_COLUMNS}`,
    [input.leadId, input.founderId, input.channel, input.messageContent, input.isFollowUp ?? false],
  );
  return mapRow(result.rows[0]);
}

/**
 * Get outreach history for a lead, sorted chronologically (oldest first).
 */
export async function getOutreachHistory(leadId: string): Promise<OutreachRecord[]> {
  const result = await query<OutreachRow>(
    `SELECT ${OUTREACH_COLUMNS} FROM outreach_record
     WHERE lead_id = $1
     ORDER BY outreach_date ASC`,
    [leadId],
  );
  return result.rows.map(mapRow);
}

/**
 * Get stale leads: contacted 7+ days ago with no reply.
 * A lead is stale if its most recent outreach is older than 7 days
 * AND its crmStatus is NOT in {Replied, Booked, Closed}.
 */
export async function getStaleLeads(founderId: string): Promise<
  Array<{
    leadId: string;
    leadName: string;
    company: string;
    crmStatus: string;
    lastOutreachDate: Date;
  }>
> {
  const result = await query<{
    lead_id: string;
    lead_name: string;
    company: string;
    crm_status: string;
    last_outreach_date: Date;
  }>(
    `SELECT
       o.lead_id,
       l.name AS lead_name,
       l.company,
       l.crm_status,
       MAX(o.outreach_date) AS last_outreach_date
     FROM outreach_record o
     JOIN lead l ON l.id = o.lead_id
     WHERE o.founder_id = $1
       AND l.is_deleted = false
       AND l.crm_status NOT IN ('Replied', 'Booked', 'Closed')
     GROUP BY o.lead_id, l.name, l.company, l.crm_status
     HAVING MAX(o.outreach_date) < NOW() - INTERVAL '7 days'
     ORDER BY MAX(o.outreach_date) ASC`,
    [founderId],
  );

  return result.rows.map((row) => ({
    leadId: row.lead_id,
    leadName: row.lead_name,
    company: row.company,
    crmStatus: row.crm_status,
    lastOutreachDate: row.last_outreach_date,
  }));
}
