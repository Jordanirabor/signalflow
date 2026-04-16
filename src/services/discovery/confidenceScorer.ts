// ============================================================
// Confidence Scorer — Multi-source corroboration scoring
// ============================================================

import type { FieldCorroboration } from './types';

/**
 * Premium API source names contain "api" (e.g., "apollo_api", "hunter_api", "clearbit_api").
 * Premium sources receive a higher weight than single-source scrapes.
 */
const PREMIUM_SOURCE_PATTERN = /api/i;

/** Weight multiplier for premium API sources. */
const PREMIUM_WEIGHT = 1.5;

/** Weight multiplier for standard scrape sources. */
const STANDARD_WEIGHT = 1.0;

/**
 * Computes a per-field confidence score based on the number of corroborating
 * sources and whether any of them are premium API sources.
 *
 * Scoring rules:
 *  - 3+ sources → base 0.9, boosted toward 1.0 by premium sources
 *  - 2 sources  → base 0.7, boosted slightly by premium sources
 *  - 1 source   → 0.5 for premium, 0.4 for standard scrape
 *  - 0 sources  → 0.0
 */
function scoreField(corroboration: FieldCorroboration): number {
  const { sources } = corroboration;
  const count = sources.length;

  if (count === 0) return 0.0;

  const hasPremium = sources.some((s) => PREMIUM_SOURCE_PATTERN.test(s));

  if (count >= 3) {
    // Base 0.9, premium presence pushes toward 1.0
    return hasPremium ? 0.95 : 0.9;
  }

  if (count === 2) {
    return hasPremium ? 0.75 : 0.7;
  }

  // Single source
  return hasPremium ? 0.5 : 0.4;
}

/**
 * Assigns an overall confidence score for a prospect based on how many
 * independent sources corroborate each data field.
 *
 * The final score is the weighted average of per-field scores, clamped to [0.0, 1.0].
 *
 * @param corroborations - Array of field corroboration objects
 * @returns A confidence score between 0.0 and 1.0
 */
export function scoreConfidence(corroborations: FieldCorroboration[]): number {
  if (corroborations.length === 0) return 0.0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const corroboration of corroborations) {
    const hasPremium = corroboration.sources.some((s) => PREMIUM_SOURCE_PATTERN.test(s));
    const weight = hasPremium ? PREMIUM_WEIGHT : STANDARD_WEIGHT;
    const fieldScore = scoreField(corroboration);

    weightedSum += fieldScore * weight;
    totalWeight += weight;
  }

  const average = totalWeight > 0 ? weightedSum / totalWeight : 0.0;

  // Clamp to [0.0, 1.0]
  return Math.min(1.0, Math.max(0.0, average));
}
