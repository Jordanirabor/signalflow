import { query } from '@/lib/db';
import type { CRMStatus, EnrichmentData, ICPProfile, Lead, ScoreBreakdown } from '@/types';

// ---------------------------------------------------------------------------
// Row type returned by Postgres
// ---------------------------------------------------------------------------

interface LeadRow {
  id: string;
  founder_id: string;
  name: string;
  role: string;
  company: string;
  industry: string | null;
  geography: string | null;
  email: string | null;
  lead_score: number;
  score_breakdown: ScoreBreakdown;
  enrichment_status: 'pending' | 'complete' | 'partial';
  enrichment_data: EnrichmentData | null;
  crm_status: CRMStatus;
  is_deleted: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  correlation_score: number | null;
  correlation_flag: string | null;
  icp_profile_id: string | null;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateLeadInput {
  founderId: string;
  name: string;
  role: string;
  company: string;
  industry?: string;
  geography?: string;
  icpProfileId?: string;
}

export interface UpdateLeadInput {
  name?: string;
  role?: string;
  company?: string;
  industry?: string;
  geography?: string;
}

export interface ListLeadsOptions {
  founderId: string;
  minScore?: number;
  sortBy?: 'score' | 'created';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRow(row: LeadRow): Lead {
  return {
    id: row.id,
    founderId: row.founder_id,
    name: row.name,
    role: row.role,
    company: row.company,
    industry: row.industry ?? undefined,
    geography: row.geography ?? undefined,
    email: row.email ?? undefined,
    leadScore: row.lead_score,
    scoreBreakdown: row.score_breakdown,
    enrichmentStatus: row.enrichment_status,
    enrichmentData: row.enrichment_data ?? undefined,
    crmStatus: row.crm_status,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    correlationScore: row.correlation_score ?? undefined,
    correlationFlag: row.correlation_flag ?? undefined,
    icpProfileId: row.icp_profile_id ?? undefined,
  };
}

const LEAD_COLUMNS = `id, founder_id, name, role, company, industry, geography, email,
  lead_score, score_breakdown, enrichment_status, enrichment_data,
  crm_status, is_deleted, deleted_at, created_at, updated_at,
  correlation_score, correlation_flag, icp_profile_id`;

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new lead. Throws on duplicate (unique constraint violation).
 * Caller should catch the constraint error and return 409.
 */
export async function createLead(
  input: CreateLeadInput,
  score: number,
  scoreBreakdown: ScoreBreakdown,
): Promise<Lead> {
  const result = await query<LeadRow>(
    `INSERT INTO lead (founder_id, name, role, company, industry, geography, lead_score, score_breakdown, icp_profile_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${LEAD_COLUMNS}`,
    [
      input.founderId,
      input.name,
      input.role,
      input.company,
      input.industry ?? null,
      input.geography ?? null,
      score,
      JSON.stringify(scoreBreakdown),
      input.icpProfileId ?? null,
    ],
  );
  return mapRow(result.rows[0]);
}

/**
 * Find an existing non-deleted lead by name+company (case-insensitive) for a founder.
 * Used for proactive duplicate detection.
 */
export async function findDuplicate(
  founderId: string,
  name: string,
  company: string,
): Promise<Lead | null> {
  const result = await query<LeadRow>(
    `SELECT ${LEAD_COLUMNS} FROM lead
     WHERE founder_id = $1 AND LOWER(name) = LOWER($2) AND LOWER(company) = LOWER($3) AND is_deleted = false
     LIMIT 1`,
    [founderId, name, company],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Get a single lead by ID (non-deleted).
 */
export async function getLeadById(id: string): Promise<Lead | null> {
  const result = await query<LeadRow>(
    `SELECT ${LEAD_COLUMNS} FROM lead WHERE id = $1 AND is_deleted = false`,
    [id],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * List leads for a founder with optional filters.
 * Default sort: leadScore DESC.
 */
export async function listLeads(options: ListLeadsOptions): Promise<Lead[]> {
  const conditions: string[] = ['founder_id = $1', 'is_deleted = false'];
  const params: unknown[] = [options.founderId];
  let paramIdx = 2;

  if (options.minScore !== undefined) {
    conditions.push(`lead_score >= $${paramIdx}`);
    params.push(options.minScore);
    paramIdx++;
  }

  const orderBy = options.sortBy === 'created' ? 'created_at DESC' : 'lead_score DESC';

  const result = await query<LeadRow>(
    `SELECT ${LEAD_COLUMNS} FROM lead
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${orderBy}`,
    params,
  );
  return result.rows.map(mapRow);
}

/**
 * Update a lead's fields. Only provided fields are updated.
 */
export async function updateLead(id: string, input: UpdateLeadInput): Promise<Lead | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${paramIdx++}`);
    params.push(input.name);
  }
  if (input.role !== undefined) {
    sets.push(`role = $${paramIdx++}`);
    params.push(input.role);
  }
  if (input.company !== undefined) {
    sets.push(`company = $${paramIdx++}`);
    params.push(input.company);
  }
  if (input.industry !== undefined) {
    sets.push(`industry = $${paramIdx++}`);
    params.push(input.industry);
  }
  if (input.geography !== undefined) {
    sets.push(`geography = $${paramIdx++}`);
    params.push(input.geography);
  }

  if (sets.length === 0) {
    return getLeadById(id);
  }

  sets.push(`updated_at = NOW()`);

  const result = await query<LeadRow>(
    `UPDATE lead SET ${sets.join(', ')} WHERE id = $${paramIdx} AND is_deleted = false
     RETURNING ${LEAD_COLUMNS}`,
    [...params, id],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Soft-delete a lead.
 */
export async function softDeleteLead(id: string): Promise<Lead | null> {
  const result = await query<LeadRow>(
    `UPDATE lead SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND is_deleted = false
     RETURNING ${LEAD_COLUMNS}`,
    [id],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Restore a soft-deleted lead.
 */
export async function restoreLead(id: string): Promise<Lead | null> {
  const result = await query<LeadRow>(
    `UPDATE lead SET is_deleted = false, deleted_at = NULL, updated_at = NOW()
     WHERE id = $1 AND is_deleted = true
     RETURNING ${LEAD_COLUMNS}`,
    [id],
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Update a lead's enrichment data, enrichment status, recalculate score, and save.
 * Accepts either an ICP (legacy V1 scoring) or an ICPProfile (V2 scoring with painPointRelevance).
 */
export async function updateLeadEnrichment(
  leadId: string,
  enrichmentData: EnrichmentData,
  enrichmentStatus: 'complete' | 'partial' | 'pending',
  icpOrProfile: import('@/types').ICP | ICPProfile,
): Promise<Lead | null> {
  // First get the current lead to have its fields for scoring
  const existing = await getLeadById(leadId);
  if (!existing) return null;

  // Determine if this is an ICPProfile (has painPoints) or legacy ICP
  const isICPProfile = 'painPoints' in icpOrProfile;

  let totalScore: number;
  let breakdown: ScoreBreakdown | import('@/types').ScoreBreakdownV2;

  if (isICPProfile) {
    const { calculateLeadScoreV2 } = await import('./scoringService');
    const scoreResult = calculateLeadScoreV2({
      lead: {
        role: existing.role,
        company: existing.company,
        industry: existing.industry,
        geography: existing.geography,
        enrichmentData,
      },
      icpProfile: icpOrProfile as ICPProfile,
    });
    totalScore = scoreResult.totalScore;
    breakdown = scoreResult.breakdown;
  } else {
    const { calculateLeadScore } = await import('./scoringService');
    const scoreResult = calculateLeadScore({
      lead: {
        role: existing.role,
        company: existing.company,
        industry: existing.industry,
        geography: existing.geography,
        enrichmentData,
      },
      icp: icpOrProfile as import('@/types').ICP,
    });
    totalScore = scoreResult.totalScore;
    breakdown = scoreResult.breakdown;
  }

  const result = await query<LeadRow>(
    `UPDATE lead
     SET enrichment_data = $1,
         enrichment_status = $2,
         lead_score = $3,
         score_breakdown = $4,
         email = COALESCE($6, email),
         updated_at = NOW()
     WHERE id = $5 AND is_deleted = false
     RETURNING ${LEAD_COLUMNS}`,
    [
      JSON.stringify(enrichmentData),
      enrichmentStatus,
      totalScore,
      JSON.stringify(breakdown),
      leadId,
      enrichmentData.email ?? null,
    ],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}
