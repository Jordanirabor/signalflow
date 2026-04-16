import { query } from '@/lib/db';
import type { ICPProject } from '@/types';

// ---------------------------------------------------------------------------
// Row type & mapper
// ---------------------------------------------------------------------------

type ICPProjectRow = {
  id: string;
  founder_id: string;
  name: string;
  product_description: string;
  is_active: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: ICPProjectRow): ICPProject {
  return {
    id: row.id,
    founderId: row.founder_id,
    name: row.name,
    productDescription: row.product_description,
    isActive: row.is_active,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ProjectValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate project name: non-empty, 1–100 characters.
 */
export function validateProjectName(name: string): ProjectValidationResult {
  const errors: string[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Project name is required');
  } else if (name.length > 100) {
    errors.push(`Project name exceeds 100 characters (${name.length})`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate product description: non-empty, 1–5000 characters.
 */
export function validateProductDescription(description: string): ProjectValidationResult {
  const errors: string[] = [];
  if (typeof description !== 'string' || description.trim().length === 0) {
    errors.push('Product description is required');
  } else if (description.length > 5000) {
    errors.push(`Product description exceeds 5000 characters (${description.length})`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Check that a project name is unique for the given founder (among non-deleted projects).
 * Optionally excludes a project ID (for updates).
 */
async function isNameUnique(
  founderId: string,
  name: string,
  excludeProjectId?: string,
): Promise<boolean> {
  const result = excludeProjectId
    ? await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM icp_project
         WHERE founder_id = $1 AND name = $2 AND is_deleted = false AND id != $3`,
        [founderId, name, excludeProjectId],
      )
    : await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM icp_project
         WHERE founder_id = $1 AND name = $2 AND is_deleted = false`,
        [founderId, name],
      );
  return parseInt(result.rows[0].count, 10) === 0;
}

// ---------------------------------------------------------------------------
// CRUD Functions (Task 2.1)
// ---------------------------------------------------------------------------

/**
 * Create a new ICP project. Validates name uniqueness, length constraints.
 */
export async function createProject(
  founderId: string,
  name: string,
  productDescription: string,
): Promise<ICPProject> {
  const nameValidation = validateProjectName(name);
  if (!nameValidation.valid) {
    throw new Error(`Invalid project: ${nameValidation.errors.join('; ')}`);
  }

  const descValidation = validateProductDescription(productDescription);
  if (!descValidation.valid) {
    throw new Error(`Invalid project: ${descValidation.errors.join('; ')}`);
  }

  const unique = await isNameUnique(founderId, name);
  if (!unique) {
    throw new Error(`A project with the name "${name}" already exists for this founder`);
  }

  const result = await query<ICPProjectRow>(
    `INSERT INTO icp_project (founder_id, name, product_description)
     VALUES ($1, $2, $3)
     RETURNING id, founder_id, name, product_description, is_active, is_deleted,
               deleted_at, created_at, updated_at`,
    [founderId, name, productDescription],
  );

  return mapRow(result.rows[0]);
}

/**
 * Fetch a single project by ID.
 */
export async function getProjectById(id: string): Promise<ICPProject | null> {
  const result = await query<ICPProjectRow>(
    `SELECT id, founder_id, name, product_description, is_active, is_deleted,
            deleted_at, created_at, updated_at
     FROM icp_project
     WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * List all non-deleted projects for a founder, ordered by created_at DESC.
 */
export async function listProjects(founderId: string): Promise<ICPProject[]> {
  const result = await query<ICPProjectRow>(
    `SELECT id, founder_id, name, product_description, is_active, is_deleted,
            deleted_at, created_at, updated_at
     FROM icp_project
     WHERE founder_id = $1 AND is_deleted = false
     ORDER BY created_at DESC`,
    [founderId],
  );

  return result.rows.map(mapRow);
}

/**
 * Return active, non-deleted projects for a founder.
 */
export async function getActiveProjects(founderId: string): Promise<ICPProject[]> {
  const result = await query<ICPProjectRow>(
    `SELECT id, founder_id, name, product_description, is_active, is_deleted,
            deleted_at, created_at, updated_at
     FROM icp_project
     WHERE founder_id = $1 AND is_active = true AND is_deleted = false
     ORDER BY created_at DESC`,
    [founderId],
  );

  return result.rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// Update / Lifecycle Functions (Task 2.2)
// ---------------------------------------------------------------------------

/**
 * Partial update of a project's name and/or product description.
 * Validates constraints and bumps updated_at.
 */
export async function updateProject(
  id: string,
  input: { name?: string; productDescription?: string },
): Promise<ICPProject | null> {
  const existing = await getProjectById(id);
  if (!existing) return null;

  const newName = input.name ?? existing.name;
  const newDescription = input.productDescription ?? existing.productDescription;

  if (input.name !== undefined) {
    const nameValidation = validateProjectName(input.name);
    if (!nameValidation.valid) {
      throw new Error(`Invalid project: ${nameValidation.errors.join('; ')}`);
    }

    const unique = await isNameUnique(existing.founderId, input.name, id);
    if (!unique) {
      throw new Error(`A project with the name "${input.name}" already exists for this founder`);
    }
  }

  if (input.productDescription !== undefined) {
    const descValidation = validateProductDescription(input.productDescription);
    if (!descValidation.valid) {
      throw new Error(`Invalid project: ${descValidation.errors.join('; ')}`);
    }
  }

  const result = await query<ICPProjectRow>(
    `UPDATE icp_project
     SET name = $1, product_description = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING id, founder_id, name, product_description, is_active, is_deleted,
               deleted_at, created_at, updated_at`,
    [newName, newDescription, id],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Archive a project by setting is_active = false.
 * Prevents archiving the last active project for the founder.
 */
export async function archiveProject(id: string): Promise<ICPProject | null> {
  const existing = await getProjectById(id);
  if (!existing) return null;

  if (existing.isActive) {
    const activeProjects = await getActiveProjects(existing.founderId);
    if (activeProjects.length <= 1) {
      throw new Error('Cannot archive the last active project for this founder');
    }
  }

  const result = await query<ICPProjectRow>(
    `UPDATE icp_project
     SET is_active = false, updated_at = NOW()
     WHERE id = $1
     RETURNING id, founder_id, name, product_description, is_active, is_deleted,
               deleted_at, created_at, updated_at`,
    [id],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Soft-delete a project. Sets is_deleted = true and deleted_at timestamp.
 * Prevents deletion of the last active project for the founder.
 */
export async function softDeleteProject(id: string): Promise<ICPProject | null> {
  const existing = await getProjectById(id);
  if (!existing) return null;

  if (existing.isActive) {
    const activeProjects = await getActiveProjects(existing.founderId);
    if (activeProjects.length <= 1) {
      throw new Error('Cannot delete the last active project for this founder');
    }
  }

  const result = await query<ICPProjectRow>(
    `UPDATE icp_project
     SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING id, founder_id, name, product_description, is_active, is_deleted,
               deleted_at, created_at, updated_at`,
    [id],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Restore a soft-deleted project. Sets is_deleted = false, is_active = true.
 */
export async function restoreProject(id: string): Promise<ICPProject | null> {
  const existing = await getProjectById(id);
  if (!existing) return null;

  const result = await query<ICPProjectRow>(
    `UPDATE icp_project
     SET is_deleted = false, is_active = true, deleted_at = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING id, founder_id, name, product_description, is_active, is_deleted,
               deleted_at, created_at, updated_at`,
    [id],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}
