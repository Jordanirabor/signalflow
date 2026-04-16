import { query } from '@/lib/db';
import type { ThrottleConfig, ThrottleStatus } from '@/types';

// ---------------------------------------------------------------------------
// Row type returned by Postgres
// ---------------------------------------------------------------------------

interface ThrottleConfigRow {
  id: string;
  founder_id: string;
  email_limit: number;
  dm_limit: number;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EMAIL_LIMIT = 20;
const DEFAULT_DM_LIMIT = 20;
const MIN_LIMIT = 5;
const MAX_LIMIT = 50;
const WARNING_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ThrottleLimitValidation {
  valid: boolean;
  errors: Record<string, string>;
}

/**
 * Validate that throttle limits are within the allowed range [5, 50].
 */
export function validateThrottleLimits(
  emailLimit?: number,
  dmLimit?: number,
): ThrottleLimitValidation {
  const errors: Record<string, string> = {};

  if (emailLimit !== undefined) {
    if (!Number.isInteger(emailLimit) || emailLimit < MIN_LIMIT || emailLimit > MAX_LIMIT) {
      errors.emailLimit = `emailLimit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`;
    }
  }
  if (dmLimit !== undefined) {
    if (!Number.isInteger(dmLimit) || dmLimit < MIN_LIMIT || dmLimit > MAX_LIMIT) {
      errors.dmLimit = `dmLimit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

function mapConfigRow(row: ThrottleConfigRow): ThrottleConfig {
  return {
    founderId: row.founder_id,
    emailLimit: row.email_limit,
    dmLimit: row.dm_limit,
  };
}

/**
 * Get the throttle config for a founder. Returns defaults if none exists.
 */
export async function getThrottleConfig(founderId: string): Promise<ThrottleConfig> {
  const result = await query<ThrottleConfigRow>(
    `SELECT id, founder_id, email_limit, dm_limit, updated_at
     FROM throttle_config WHERE founder_id = $1`,
    [founderId],
  );

  if (result.rows.length === 0) {
    return { founderId, emailLimit: DEFAULT_EMAIL_LIMIT, dmLimit: DEFAULT_DM_LIMIT };
  }

  return mapConfigRow(result.rows[0]);
}

/**
 * Create or update throttle config for a founder.
 */
export async function saveThrottleConfig(
  founderId: string,
  emailLimit: number,
  dmLimit: number,
): Promise<ThrottleConfig> {
  const result = await query<ThrottleConfigRow>(
    `INSERT INTO throttle_config (founder_id, email_limit, dm_limit)
     VALUES ($1, $2, $3)
     ON CONFLICT (founder_id)
     DO UPDATE SET email_limit = $2, dm_limit = $3, updated_at = NOW()
     RETURNING id, founder_id, email_limit, dm_limit, updated_at`,
    [founderId, emailLimit, dmLimit],
  );

  return mapConfigRow(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Daily usage counting
// ---------------------------------------------------------------------------

/**
 * Get the number of outreach records for a founder+channel today.
 */
export async function getDailyUsage(founderId: string, channel: 'email' | 'dm'): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM outreach_record
     WHERE founder_id = $1 AND channel = $2
       AND outreach_date >= DATE_TRUNC('day', NOW())`,
    [founderId, channel],
  );

  return parseInt(result.rows[0].count, 10);
}

/**
 * Get the throttle status for a founder and channel.
 */
export async function getThrottleStatus(
  founderId: string,
  channel: 'email' | 'dm',
): Promise<ThrottleStatus> {
  const config = await getThrottleConfig(founderId);
  const limit = channel === 'email' ? config.emailLimit : config.dmLimit;
  const used = await getDailyUsage(founderId, channel);
  const remaining = Math.max(0, limit - used);
  const warningThreshold = used >= WARNING_THRESHOLD * limit;

  return { channel, used, limit, remaining, warningThreshold };
}

/**
 * Check whether a new outreach action is allowed for the given founder+channel.
 * Returns true if under the limit, false if at or over.
 */
export async function canRecordOutreach(
  founderId: string,
  channel: 'email' | 'dm',
): Promise<boolean> {
  const status = await getThrottleStatus(founderId, channel);
  return status.remaining > 0;
}
