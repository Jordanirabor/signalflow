import pool, { query } from '@/lib/db';
import type { ICPProfile, ICPSet } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ICPProfileValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

/**
 * Validate pain points array: accept 1–10 entries, each non-empty and ≤200 chars.
 */
export function validatePainPoints(painPoints: string[]): ICPProfileValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(painPoints) || painPoints.length === 0) {
    errors.push('painPoints must contain at least 1 entry');
  } else if (painPoints.length > 10) {
    errors.push('painPoints must contain at most 10 entries');
  }

  painPoints.forEach((pp, i) => {
    if (typeof pp !== 'string' || pp.trim().length === 0) {
      errors.push(`painPoints[${i}] must be a non-empty string`);
    } else if (pp.length > 200) {
      errors.push(`painPoints[${i}] exceeds 200 characters (${pp.length})`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Validate buying signals array: accept 1–5 entries, each non-empty and ≤200 chars.
 */
export function validateBuyingSignals(signals: string[]): ICPProfileValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(signals) || signals.length === 0) {
    errors.push('buyingSignals must contain at least 1 entry');
  } else if (signals.length > 5) {
    errors.push('buyingSignals must contain at most 5 entries');
  }

  signals.forEach((sig, i) => {
    if (typeof sig !== 'string' || sig.trim().length === 0) {
      errors.push(`buyingSignals[${i}] must be a non-empty string`);
    } else if (sig.length > 200) {
      errors.push(`buyingSignals[${i}] exceeds 200 characters (${sig.length})`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an ICP profile input for creation/update.
 * Rejects missing targetRole, missing industry, or zero painPoints.
 */
export function validateICPProfile(input: Partial<ICPProfile>): ICPProfileValidationResult {
  const errors: string[] = [];

  if (!input.targetRole || input.targetRole.trim() === '') {
    errors.push('targetRole is required');
  }

  if (!input.industry || input.industry.trim() === '') {
    errors.push('industry is required');
  }

  if (!input.painPoints || !Array.isArray(input.painPoints) || input.painPoints.length === 0) {
    errors.push('At least 1 painPoint is required');
  } else {
    const ppResult = validatePainPoints(input.painPoints);
    if (!ppResult.valid) {
      errors.push(...ppResult.errors);
    }
  }

  if (
    input.buyingSignals !== undefined &&
    Array.isArray(input.buyingSignals) &&
    input.buyingSignals.length > 0
  ) {
    const bsResult = validateBuyingSignals(input.buyingSignals);
    if (!bsResult.valid) {
      errors.push(...bsResult.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Row type & mapper
// ---------------------------------------------------------------------------

type ICPProfileRow = {
  id: string;
  founder_id: string;
  project_id: string | null;
  target_role: string;
  industry: string;
  company_stage: string | null;
  geography: string | null;
  pain_points: string[];
  buying_signals: string[];
  custom_tags: string[] | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: ICPProfileRow): ICPProfile {
  return {
    id: row.id,
    founderId: row.founder_id,
    projectId: row.project_id ?? undefined,
    targetRole: row.target_role,
    industry: row.industry,
    companyStage: row.company_stage ?? undefined,
    geography: row.geography ?? undefined,
    painPoints: row.pain_points ?? [],
    buyingSignals: row.buying_signals ?? [],
    customTags: row.custom_tags ?? undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD Functions
// ---------------------------------------------------------------------------

/**
 * Return all ICP profiles for a founder, ordered by created_at ASC.
 * Optionally filter by projectId.
 */
export async function getICPSet(founderId: string, projectId?: string): Promise<ICPSet> {
  const params: unknown[] = [founderId];
  let whereClause = 'WHERE founder_id = $1';

  if (projectId) {
    params.push(projectId);
    whereClause += ` AND project_id = $${params.length}`;
  }

  const result = await query<ICPProfileRow>(
    `SELECT id, founder_id, project_id, target_role, industry, company_stage, geography,
            pain_points, buying_signals, custom_tags, is_active, created_at, updated_at
     FROM icp_profile
     ${whereClause}
     ORDER BY created_at ASC`,
    params,
  );

  const profiles = result.rows.map(mapRow);
  return {
    founderId,
    profiles,
    activeCount: profiles.filter((p) => p.isActive).length,
  };
}

/**
 * Return only active (isActive = true) profiles for a founder.
 * Optionally filter by projectId.
 */
export async function getActiveProfiles(
  founderId: string,
  projectId?: string,
): Promise<ICPProfile[]> {
  const params: unknown[] = [founderId];
  let whereClause = 'WHERE founder_id = $1 AND is_active = true';

  if (projectId) {
    params.push(projectId);
    whereClause += ` AND project_id = $${params.length}`;
  }

  const result = await query<ICPProfileRow>(
    `SELECT id, founder_id, project_id, target_role, industry, company_stage, geography,
            pain_points, buying_signals, custom_tags, is_active, created_at, updated_at
     FROM icp_profile
     ${whereClause}
     ORDER BY created_at ASC`,
    params,
  );

  return result.rows.map(mapRow);
}

/**
 * Fetch a single ICP profile by its id.
 */
export async function getICPProfileById(id: string): Promise<ICPProfile | null> {
  const result = await query<ICPProfileRow>(
    `SELECT id, founder_id, project_id, target_role, industry, company_stage, geography,
            pain_points, buying_signals, custom_tags, is_active, created_at, updated_at
     FROM icp_profile
     WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Create a new ICP profile. Validates input before saving.
 * isActive defaults to true if not provided.
 */
export async function createICPProfile(
  input: Omit<ICPProfile, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<ICPProfile> {
  const validation = validateICPProfile(input);
  if (!validation.valid) {
    throw new Error(`Invalid ICP profile: ${validation.errors.join('; ')}`);
  }

  const isActive = input.isActive ?? true;

  const result = await query<ICPProfileRow>(
    `INSERT INTO icp_profile
       (founder_id, project_id, target_role, industry, company_stage, geography,
        pain_points, buying_signals, custom_tags, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, founder_id, project_id, target_role, industry, company_stage, geography,
               pain_points, buying_signals, custom_tags, is_active, created_at, updated_at`,
    [
      input.founderId,
      input.projectId ?? null,
      input.targetRole,
      input.industry,
      input.companyStage ?? null,
      input.geography ?? null,
      input.painPoints,
      input.buyingSignals ?? [],
      input.customTags ?? null,
      isActive,
    ],
  );

  return mapRow(result.rows[0]);
}

/**
 * Partial update of an ICP profile. Updates only provided fields and bumps updatedAt.
 */
export async function updateICPProfile(
  id: string,
  input: Partial<ICPProfile>,
): Promise<ICPProfile | null> {
  const existing = await getICPProfileById(id);
  if (!existing) return null;

  const merged = {
    targetRole: input.targetRole ?? existing.targetRole,
    industry: input.industry ?? existing.industry,
    companyStage: input.companyStage !== undefined ? input.companyStage : existing.companyStage,
    geography: input.geography !== undefined ? input.geography : existing.geography,
    painPoints: input.painPoints ?? existing.painPoints,
    buyingSignals: input.buyingSignals ?? existing.buyingSignals,
    customTags: input.customTags !== undefined ? input.customTags : existing.customTags,
    isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
  };

  const result = await query<ICPProfileRow>(
    `UPDATE icp_profile
     SET target_role = $1, industry = $2, company_stage = $3, geography = $4,
         pain_points = $5, buying_signals = $6, custom_tags = $7, is_active = $8,
         updated_at = NOW()
     WHERE id = $9
     RETURNING id, founder_id, project_id, target_role, industry, company_stage, geography,
               pain_points, buying_signals, custom_tags, is_active, created_at, updated_at`,
    [
      merged.targetRole,
      merged.industry,
      merged.companyStage ?? null,
      merged.geography ?? null,
      merged.painPoints,
      merged.buyingSignals,
      merged.customTags ?? null,
      merged.isActive,
      id,
    ],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Delete an ICP profile. Leads are retained via ON DELETE SET NULL on the FK.
 */
export async function deleteICPProfile(id: string): Promise<boolean> {
  const result = await query(`DELETE FROM icp_profile WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Toggle a profile's active/inactive state.
 */
export async function setProfileActive(id: string, isActive: boolean): Promise<ICPProfile | null> {
  const result = await query<ICPProfileRow>(
    `UPDATE icp_profile
     SET is_active = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, founder_id, project_id, target_role, industry, company_stage, geography,
               pain_points, buying_signals, custom_tags, is_active, created_at, updated_at`,
    [isActive, id],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Replace the ICP set for a founder within a transaction.
 * When projectId is provided, scopes deletion and insertion to that project only.
 * When projectId is omitted, deletes all profiles for the founder (legacy behavior).
 */
export async function replaceICPSet(
  founderId: string,
  profiles: Omit<ICPProfile, 'id' | 'createdAt' | 'updatedAt'>[],
  projectId?: string,
): Promise<ICPSet> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete existing profiles scoped to project or all founder profiles
    if (projectId) {
      await client.query('DELETE FROM icp_profile WHERE founder_id = $1 AND project_id = $2', [
        founderId,
        projectId,
      ]);
    } else {
      await client.query('DELETE FROM icp_profile WHERE founder_id = $1', [founderId]);
    }

    // Insert new profiles
    const inserted: ICPProfile[] = [];
    for (const profile of profiles) {
      const validation = validateICPProfile(profile);
      if (!validation.valid) {
        throw new Error(`Invalid ICP profile: ${validation.errors.join('; ')}`);
      }

      const isActive = profile.isActive ?? true;
      const effectiveProjectId = profile.projectId ?? projectId ?? null;

      const result = await client.query<ICPProfileRow>(
        `INSERT INTO icp_profile
           (founder_id, project_id, target_role, industry, company_stage, geography,
            pain_points, buying_signals, custom_tags, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, founder_id, project_id, target_role, industry, company_stage, geography,
                   pain_points, buying_signals, custom_tags, is_active, created_at, updated_at`,
        [
          founderId,
          effectiveProjectId,
          profile.targetRole,
          profile.industry,
          profile.companyStage ?? null,
          profile.geography ?? null,
          profile.painPoints,
          profile.buyingSignals ?? [],
          profile.customTags ?? null,
          isActive,
        ],
      );

      inserted.push(mapRow(result.rows[0]));
    }

    await client.query('COMMIT');

    return {
      founderId,
      profiles: inserted,
      activeCount: inserted.filter((p) => p.isActive).length,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Move an ICP profile to a different project by updating its project_id.
 */
export async function moveProfileToProject(
  profileId: string,
  targetProjectId: string,
): Promise<ICPProfile | null> {
  const result = await query<ICPProfileRow>(
    `UPDATE icp_profile
     SET project_id = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, founder_id, project_id, target_role, industry, company_stage, geography,
               pain_points, buying_signals, custom_tags, is_active, created_at, updated_at`,
    [targetProjectId, profileId],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}
