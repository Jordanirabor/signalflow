import { query } from '@/lib/db';
import type { CRMStatus, Lead, ScoreBreakdown, StatusChange } from '@/types';
import { CRM_PIPELINE_ORDER } from '@/types';

// ---------------------------------------------------------------------------
// Row types returned by Postgres
// ---------------------------------------------------------------------------

interface StatusChangeRow {
  id: string;
  lead_id: string;
  from_status: CRMStatus;
  to_status: CRMStatus;
  reason: string | null;
  meeting_date: Date | null;
  changed_at: Date;
}

interface PipelineLeadRow {
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
  crm_status: CRMStatus;
  created_at: Date;
  updated_at: Date;
  last_activity: Date;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ChangeStatusInput {
  leadId: string;
  toStatus: CRMStatus;
  reason?: string;
  meetingDate?: string; // ISO date string
}

export interface PipelineFilters {
  founderId: string;
  status?: CRMStatus;
  minScore?: number;
  maxScore?: number;
  lastActivityAfter?: string; // ISO date string
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface PipelineLead {
  id: string;
  founderId: string;
  name: string;
  role: string;
  company: string;
  industry?: string;
  geography?: string;
  leadScore: number;
  scoreBreakdown: ScoreBreakdown;
  enrichmentStatus: 'pending' | 'complete' | 'partial';
  crmStatus: CRMStatus;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date;
}

export interface PipelineView {
  counts: Record<CRMStatus, number>;
  leads: PipelineLead[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStatusChangeRow(row: StatusChangeRow): StatusChange {
  return {
    id: row.id,
    leadId: row.lead_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason ?? undefined,
    meetingDate: row.meeting_date ?? undefined,
    changedAt: row.changed_at,
  };
}

function mapPipelineLeadRow(row: PipelineLeadRow): PipelineLead {
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
    crmStatus: row.crm_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivity: row.last_activity,
  };
}

const VALID_STATUSES: CRMStatus[] = ['New', 'Contacted', 'Replied', 'Booked', 'Closed'];

/**
 * Check whether a status string is a valid CRMStatus.
 */
export function isValidCRMStatus(status: string): status is CRMStatus {
  return VALID_STATUSES.includes(status as CRMStatus);
}

/**
 * Determine if a status transition is a backward move in the pipeline.
 */
export function isBackwardMove(from: CRMStatus, to: CRMStatus): boolean {
  return CRM_PIPELINE_ORDER[to] < CRM_PIPELINE_ORDER[from];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errorCode?: string;
  message?: string;
}

/**
 * Validate a CRM status transition.
 * - Backward moves require a reason (Req 6.6)
 * - Moving to Booked requires a meetingDate (Req 6.4)
 */
export function validateStatusTransition(
  fromStatus: CRMStatus,
  input: ChangeStatusInput,
): ValidationResult {
  if (!isValidCRMStatus(input.toStatus)) {
    return {
      valid: false,
      errorCode: 'VALIDATION_ERROR',
      message: `Invalid status: ${input.toStatus}. Must be one of: ${VALID_STATUSES.join(', ')}`,
    };
  }

  if (isBackwardMove(fromStatus, input.toStatus) && (!input.reason || input.reason.trim() === '')) {
    return {
      valid: false,
      errorCode: 'REASON_REQUIRED',
      message: 'A reason is required when moving a lead backward in the pipeline',
    };
  }

  if (input.toStatus === 'Booked' && !input.meetingDate) {
    return {
      valid: false,
      errorCode: 'MEETING_DATE_REQUIRED',
      message: 'A meeting date is required when moving a lead to Booked status',
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/**
 * Change a lead's CRM status and record the transition in status_change.
 * Returns the StatusChange record on success, or null if the lead was not found.
 */
export async function changeLeadStatus(input: ChangeStatusInput): Promise<{
  statusChange: StatusChange;
  updatedLead: Lead;
} | null> {
  const leadResult = await query<{ crm_status: CRMStatus }>(
    `SELECT crm_status FROM lead WHERE id = $1 AND is_deleted = false`,
    [input.leadId],
  );

  if (leadResult.rows.length === 0) return null;

  const fromStatus = leadResult.rows[0].crm_status;

  // Update the lead's crm_status
  await query(`UPDATE lead SET crm_status = $1, updated_at = NOW() WHERE id = $2`, [
    input.toStatus,
    input.leadId,
  ]);

  // Record the status change
  const changeResult = await query<StatusChangeRow>(
    `INSERT INTO status_change (lead_id, from_status, to_status, reason, meeting_date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, lead_id, from_status, to_status, reason, meeting_date, changed_at`,
    [
      input.leadId,
      fromStatus,
      input.toStatus,
      input.reason ?? null,
      input.meetingDate ? new Date(input.meetingDate) : null,
    ],
  );

  // Fetch the updated lead
  const updatedLeadResult = await query<{
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
  }>(
    `SELECT id, founder_id, name, role, company, industry, geography,
            lead_score, score_breakdown, enrichment_status, enrichment_data,
            crm_status, is_deleted, deleted_at, created_at, updated_at
     FROM lead WHERE id = $1`,
    [input.leadId],
  );

  const row = updatedLeadResult.rows[0];
  const updatedLead: Lead = {
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

  return {
    statusChange: mapStatusChangeRow(changeResult.rows[0]),
    updatedLead,
  };
}

/**
 * Get the pipeline view: all non-deleted leads grouped by status with counts.
 * Supports filters: status, minScore, maxScore, lastActivityAfter.
 */
export async function getPipeline(filters: PipelineFilters): Promise<PipelineView> {
  // Build the filtered leads query
  const conditions: string[] = ['l.founder_id = $1', 'l.is_deleted = false'];
  const params: unknown[] = [filters.founderId];
  let paramIdx = 2;

  if (filters.status) {
    conditions.push(`l.crm_status = $${paramIdx}`);
    params.push(filters.status);
    paramIdx++;
  }

  if (filters.minScore !== undefined) {
    conditions.push(`l.lead_score >= $${paramIdx}`);
    params.push(filters.minScore);
    paramIdx++;
  }

  if (filters.maxScore !== undefined) {
    conditions.push(`l.lead_score <= $${paramIdx}`);
    params.push(filters.maxScore);
    paramIdx++;
  }

  if (filters.lastActivityAfter) {
    conditions.push(`l.updated_at >= $${paramIdx}`);
    params.push(new Date(filters.lastActivityAfter));
    paramIdx++;
  }

  const whereClause = conditions.join(' AND ');

  const leadsResult = await query<PipelineLeadRow>(
    `SELECT l.id, l.founder_id, l.name, l.role, l.company, l.industry, l.geography,
            l.lead_score, l.score_breakdown, l.enrichment_status, l.crm_status,
            l.created_at, l.updated_at,
            l.updated_at AS last_activity
     FROM lead l
     WHERE ${whereClause}
     ORDER BY l.lead_score DESC`,
    params,
  );

  const leads = leadsResult.rows.map(mapPipelineLeadRow);

  // Compute counts from the filtered result set
  const counts: Record<CRMStatus, number> = {
    New: 0,
    Contacted: 0,
    Replied: 0,
    Booked: 0,
    Closed: 0,
  };

  for (const lead of leads) {
    counts[lead.crmStatus]++;
  }

  return { counts, leads };
}

/**
 * Get status change history for a lead, sorted chronologically.
 */
export async function getStatusHistory(leadId: string): Promise<StatusChange[]> {
  const result = await query<StatusChangeRow>(
    `SELECT id, lead_id, from_status, to_status, reason, meeting_date, changed_at
     FROM status_change
     WHERE lead_id = $1
     ORDER BY changed_at ASC`,
    [leadId],
  );
  return result.rows.map(mapStatusChangeRow);
}
