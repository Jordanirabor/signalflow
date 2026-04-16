import { query } from '@/lib/db';
import type { PipelineConfig, TonePreference } from '@/types';

// ---------------------------------------------------------------------------
// Row type returned by Postgres
// ---------------------------------------------------------------------------

interface PipelineConfigRow {
  id: string;
  founder_id: string;
  run_interval_minutes: number;
  business_hours_start: string;
  business_hours_end: string;
  business_days: number[];
  timezone: string;
  daily_discovery_cap: number;
  min_lead_score: number;
  max_follow_ups: number;
  sequence_cadence_days: number[];
  tone_preference: string;
  product_context: string;
  value_proposition: string;
  target_pain_points: string[];
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: PipelineConfig = {
  founderId: '',
  runIntervalMinutes: 60,
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  businessDays: [1, 2, 3, 4, 5],
  timezone: 'America/New_York',
  dailyDiscoveryCap: 50,
  minLeadScore: 10,
  maxFollowUps: 3,
  sequenceCadenceDays: [3, 5, 7],
  tonePreference: 'professional',
  productContext: '',
  valueProposition: '',
  targetPainPoints: [],
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface PipelineConfigValidation {
  valid: boolean;
  errors: Record<string, string>;
}

/**
 * Pure validation function for pipeline configuration values.
 * Returns per-field error messages for out-of-range values.
 */
export function validatePipelineConfig(config: Partial<PipelineConfig>): PipelineConfigValidation {
  const errors: Record<string, string> = {};

  if (config.runIntervalMinutes !== undefined) {
    if (
      !Number.isInteger(config.runIntervalMinutes) ||
      config.runIntervalMinutes < 15 ||
      config.runIntervalMinutes > 240
    ) {
      errors.runIntervalMinutes = 'runIntervalMinutes must be an integer between 15 and 240';
    }
  }

  if (config.dailyDiscoveryCap !== undefined) {
    if (
      !Number.isInteger(config.dailyDiscoveryCap) ||
      config.dailyDiscoveryCap < 10 ||
      config.dailyDiscoveryCap > 200
    ) {
      errors.dailyDiscoveryCap = 'dailyDiscoveryCap must be an integer between 10 and 200';
    }
  }

  if (config.maxFollowUps !== undefined) {
    if (
      !Number.isInteger(config.maxFollowUps) ||
      config.maxFollowUps < 1 ||
      config.maxFollowUps > 5
    ) {
      errors.maxFollowUps = 'maxFollowUps must be an integer between 1 and 5';
    }
  }

  if (config.minLeadScore !== undefined) {
    if (
      !Number.isInteger(config.minLeadScore) ||
      config.minLeadScore < 0 ||
      config.minLeadScore > 90
    ) {
      errors.minLeadScore = 'minLeadScore must be an integer between 0 and 90';
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function mapConfigRow(row: PipelineConfigRow): PipelineConfig {
  return {
    founderId: row.founder_id,
    runIntervalMinutes: row.run_interval_minutes,
    businessHoursStart: row.business_hours_start,
    businessHoursEnd: row.business_hours_end,
    businessDays: row.business_days,
    timezone: row.timezone,
    dailyDiscoveryCap: row.daily_discovery_cap,
    minLeadScore: row.min_lead_score,
    maxFollowUps: row.max_follow_ups,
    sequenceCadenceDays: row.sequence_cadence_days,
    tonePreference: row.tone_preference as TonePreference,
    productContext: row.product_context,
    valueProposition: row.value_proposition,
    targetPainPoints: row.target_pain_points,
  };
}

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

/**
 * Get the pipeline config for a founder. Returns defaults if none exists.
 */
export async function getPipelineConfig(founderId: string): Promise<PipelineConfig> {
  const result = await query<PipelineConfigRow>(
    `SELECT id, founder_id, run_interval_minutes, business_hours_start, business_hours_end,
            business_days, timezone, daily_discovery_cap, min_lead_score, max_follow_ups,
            sequence_cadence_days, tone_preference, product_context, value_proposition,
            target_pain_points, created_at, updated_at
     FROM pipeline_config WHERE founder_id = $1`,
    [founderId],
  );

  if (result.rows.length === 0) {
    return { ...DEFAULTS, founderId };
  }

  return mapConfigRow(result.rows[0]);
}

/**
 * Create or update pipeline config for a founder (UPSERT).
 */
export async function savePipelineConfig(config: PipelineConfig): Promise<PipelineConfig> {
  const result = await query<PipelineConfigRow>(
    `INSERT INTO pipeline_config (
       founder_id, run_interval_minutes, business_hours_start, business_hours_end,
       business_days, timezone, daily_discovery_cap, min_lead_score, max_follow_ups,
       sequence_cadence_days, tone_preference, product_context, value_proposition,
       target_pain_points
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (founder_id)
     DO UPDATE SET
       run_interval_minutes = $2, business_hours_start = $3, business_hours_end = $4,
       business_days = $5, timezone = $6, daily_discovery_cap = $7, min_lead_score = $8,
       max_follow_ups = $9, sequence_cadence_days = $10, tone_preference = $11,
       product_context = $12, value_proposition = $13, target_pain_points = $14,
       updated_at = NOW()
     RETURNING id, founder_id, run_interval_minutes, business_hours_start, business_hours_end,
               business_days, timezone, daily_discovery_cap, min_lead_score, max_follow_ups,
               sequence_cadence_days, tone_preference, product_context, value_proposition,
               target_pain_points, created_at, updated_at`,
    [
      config.founderId,
      config.runIntervalMinutes,
      config.businessHoursStart,
      config.businessHoursEnd,
      config.businessDays,
      config.timezone,
      config.dailyDiscoveryCap,
      config.minLeadScore,
      config.maxFollowUps,
      config.sequenceCadenceDays,
      config.tonePreference,
      config.productContext,
      config.valueProposition,
      config.targetPainPoints,
    ],
  );

  return mapConfigRow(result.rows[0]);
}
