import { query } from '@/lib/db';
import type { CRMStatus, Lead, ScoreBreakdown, UpcomingMeeting, WeeklySummary } from '@/types';

// ---------------------------------------------------------------------------
// Row types returned by Postgres
// ---------------------------------------------------------------------------

interface LeadRow {
  id: string;
  founder_id: string;
  name: string;
  role: string;
  company: string;
  industry: string | null;
  geography: string | null;
  lead_score: number;
  score_breakdown: ScoreBreakdown;
  enrichment_status: 'pending' | 'complete' | 'partial';
  enrichment_data: Record<string, unknown> | null;
  crm_status: CRMStatus;
  is_deleted: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface StatusCountRow {
  crm_status: CRMStatus;
  count: string;
}

interface UpcomingMeetingRow {
  lead_name: string;
  meeting_date: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapLeadRow(row: LeadRow): Lead {
  return {
    id: row.id,
    founderId: row.founder_id,
    name: row.name,
    role: row.role,
    company: row.company,
    industry: row.industry ?? undefined,
    geography: row.geography ?? undefined,
    leadScore: row.lead_score,
    scoreBreakdown: row.score_breakdown,
    enrichmentStatus: row.enrichment_status,
    enrichmentData: row.enrichment_data as Lead['enrichmentData'],
    crmStatus: row.crm_status,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get the start of the current week (Monday 00:00:00 UTC).
 */
function getWeekStart(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

// ---------------------------------------------------------------------------
// Weekly metric computations
// ---------------------------------------------------------------------------

/**
 * Count distinct leads with at least one outreach record this week.
 * Property 16: leadsContacted
 */
async function getLeadsContactedThisWeek(founderId: string, weekStart: Date): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT lead_id)::text AS count
     FROM outreach_record
     WHERE founder_id = $1
       AND outreach_date >= $2`,
    [founderId, weekStart],
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Count leads that have moved to Replied or beyond (Replied, Booked, Closed)
 * among those contacted this week.
 * Property 16: replyRate = (replied or beyond) / leadsContacted * 100
 */
async function getRepliedOrBeyondCount(founderId: string, weekStart: Date): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT o.lead_id)::text AS count
     FROM outreach_record o
     JOIN lead l ON l.id = o.lead_id
     WHERE o.founder_id = $1
       AND o.outreach_date >= $2
       AND l.crm_status IN ('Replied', 'Booked', 'Closed')`,
    [founderId, weekStart],
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Count leads moved to Booked status this week.
 * Property 16: meetingsBooked
 */
async function getMeetingsBookedThisWeek(founderId: string, weekStart: Date): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT sc.lead_id)::text AS count
     FROM status_change sc
     JOIN lead l ON l.id = sc.lead_id
     WHERE l.founder_id = $1
       AND sc.to_status = 'Booked'
       AND sc.changed_at >= $2`,
    [founderId, weekStart],
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Count leads that went from Booked to Closed this week.
 * conversionRate = (Booked → Closed this week) / meetingsBooked * 100
 */
async function getBookedToClosedThisWeek(founderId: string, weekStart: Date): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT sc.lead_id)::text AS count
     FROM status_change sc
     JOIN lead l ON l.id = sc.lead_id
     WHERE l.founder_id = $1
       AND sc.from_status = 'Booked'
       AND sc.to_status = 'Closed'
       AND sc.changed_at >= $2`,
    [founderId, weekStart],
  );
  return parseInt(result.rows[0].count, 10);
}

// ---------------------------------------------------------------------------
// Status counts
// ---------------------------------------------------------------------------

/**
 * Get counts of non-deleted leads per CRM status.
 * Property 11 / Requirement 8.2
 */
async function getStatusCounts(founderId: string): Promise<Record<CRMStatus, number>> {
  const result = await query<StatusCountRow>(
    `SELECT crm_status, COUNT(*)::text AS count
     FROM lead
     WHERE founder_id = $1 AND is_deleted = false
     GROUP BY crm_status`,
    [founderId],
  );

  const counts: Record<CRMStatus, number> = {
    New: 0,
    Contacted: 0,
    Replied: 0,
    Booked: 0,
    Closed: 0,
  };

  for (const row of result.rows) {
    counts[row.crm_status] = parseInt(row.count, 10);
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Upcoming meetings
// ---------------------------------------------------------------------------

/**
 * Leads with Booked status and future meetingDate, sorted ascending.
 * Property 17 / Requirement 8.4
 */
async function getUpcomingMeetings(founderId: string): Promise<UpcomingMeeting[]> {
  const result = await query<UpcomingMeetingRow>(
    `SELECT l.name AS lead_name, sc.meeting_date
     FROM status_change sc
     JOIN lead l ON l.id = sc.lead_id
     WHERE l.founder_id = $1
       AND l.is_deleted = false
       AND sc.to_status = 'Booked'
       AND sc.meeting_date IS NOT NULL
       AND sc.meeting_date > NOW()
       AND l.crm_status = 'Booked'
     ORDER BY sc.meeting_date ASC`,
    [founderId],
  );

  return result.rows.map((row) => {
    const d = new Date(row.meeting_date);
    return {
      leadName: row.lead_name,
      date: d,
      time: d.toISOString().slice(11, 16), // HH:MM
    };
  });
}

// ---------------------------------------------------------------------------
// High-priority suggestions
// ---------------------------------------------------------------------------

/**
 * Non-deleted leads with leadScore > 80 AND crmStatus == 'New'.
 * Property 18 / Requirement 8.5
 */
async function getHighPrioritySuggestions(founderId: string): Promise<Lead[]> {
  const result = await query<LeadRow>(
    `SELECT id, founder_id, name, role, company, industry, geography,
            lead_score, score_breakdown, enrichment_status, enrichment_data,
            crm_status, is_deleted, deleted_at, created_at, updated_at
     FROM lead
     WHERE founder_id = $1
       AND is_deleted = false
       AND lead_score > 80
       AND crm_status = 'New'
     ORDER BY lead_score DESC`,
    [founderId],
  );

  return result.rows.map(mapLeadRow);
}

// ---------------------------------------------------------------------------
// Low meeting prompt
// ---------------------------------------------------------------------------

/**
 * When meetingsBooked < 3 this week, suggest leads to contact based on leadScore.
 * Property 19 / Requirement 8.6
 */
async function getLowMeetingPromptLeads(founderId: string): Promise<Lead[]> {
  const result = await query<LeadRow>(
    `SELECT id, founder_id, name, role, company, industry, geography,
            lead_score, score_breakdown, enrichment_status, enrichment_data,
            crm_status, is_deleted, deleted_at, created_at, updated_at
     FROM lead
     WHERE founder_id = $1
       AND is_deleted = false
       AND crm_status IN ('New', 'Contacted')
     ORDER BY lead_score DESC
     LIMIT 10`,
    [founderId],
  );

  return result.rows.map(mapLeadRow);
}

// ---------------------------------------------------------------------------
// Main summary function
// ---------------------------------------------------------------------------

/**
 * Compute the weekly dashboard summary for a founder.
 *
 * Requirements: 8.1, 8.2, 8.4, 8.5, 8.6
 */
export async function getWeeklySummary(founderId: string): Promise<WeeklySummary> {
  const weekStart = getWeekStart();

  const [
    leadsContacted,
    repliedOrBeyond,
    meetingsBooked,
    bookedToClosed,
    statusCounts,
    upcomingMeetings,
    highPrioritySuggestions,
  ] = await Promise.all([
    getLeadsContactedThisWeek(founderId, weekStart),
    getRepliedOrBeyondCount(founderId, weekStart),
    getMeetingsBookedThisWeek(founderId, weekStart),
    getBookedToClosedThisWeek(founderId, weekStart),
    getStatusCounts(founderId),
    getUpcomingMeetings(founderId),
    getHighPrioritySuggestions(founderId),
  ]);

  const replyRate = leadsContacted > 0 ? (repliedOrBeyond / leadsContacted) * 100 : 0;
  const conversionRate = meetingsBooked > 0 ? (bookedToClosed / meetingsBooked) * 100 : 0;

  // Property 19: low meeting prompt shown when < 3 meetings booked this week
  let lowMeetingPrompt: Lead[] | undefined;
  if (meetingsBooked < 3) {
    lowMeetingPrompt = await getLowMeetingPromptLeads(founderId);
  }

  return {
    leadsContacted,
    replyRate,
    meetingsBooked,
    conversionRate,
    statusCounts,
    upcomingMeetings,
    highPrioritySuggestions,
    lowMeetingPrompt,
  };
}
