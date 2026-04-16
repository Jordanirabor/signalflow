import type {
  ICPProfile,
  ScoringInput,
  ScoringInputV2,
  ScoringOutput,
  ScoringOutputV2,
} from '@/types';

/**
 * Pure function that computes a lead score from ICP and lead data.
 *
 * Score breakdown:
 *   icpMatch      (0–40): industry, geography, company stage match against ICP
 *   roleRelevance (0–30): how closely the lead's role matches the ICP target role
 *   intentSignals (0–30): availability of enrichment data (linkedinBio, recentPosts, companyInfo)
 *
 * Total is clamped to [1, 100] and breakdown always sums to totalScore.
 */
export function calculateLeadScore(input: ScoringInput): ScoringOutput {
  const { lead, icp } = input;

  const icpMatch = computeICPMatch(lead, icp);
  const roleRelevance = computeRoleRelevance(lead.role, icp.targetRole);
  const intentSignals = computeIntentSignals(lead.enrichmentData);

  const rawTotal = icpMatch + roleRelevance + intentSignals;
  const totalScore = Math.max(1, Math.min(100, rawTotal));

  // If clamping changed the total, proportionally adjust the breakdown so it still sums.
  if (totalScore !== rawTotal) {
    return adjustBreakdown(icpMatch, roleRelevance, intentSignals, totalScore);
  }

  return {
    totalScore,
    breakdown: { icpMatch, roleRelevance, intentSignals },
  };
}

// ---------------------------------------------------------------------------
// ICP Match (0–40)
// ---------------------------------------------------------------------------

function computeICPMatch(lead: ScoringInput['lead'], icp: ScoringInput['icp']): number {
  let score = 0;

  // Industry match: 20 points
  if (lead.industry && icp.industry) {
    if (normalize(lead.industry) === normalize(icp.industry)) {
      score += 20;
    }
  }

  // Geography match: 12 points
  if (lead.geography && icp.geography) {
    if (normalize(lead.geography) === normalize(icp.geography)) {
      score += 12;
    }
  }

  // Company stage match: 8 points (uses ICP companyStage vs lead company name heuristic)
  if (icp.companyStage && lead.company) {
    // Simple heuristic: if the lead's company string contains the stage keyword, award points
    if (normalize(lead.company).includes(normalize(icp.companyStage))) {
      score += 8;
    }
  }

  return Math.min(40, score);
}

// ---------------------------------------------------------------------------
// Role Relevance (0–30)
// ---------------------------------------------------------------------------

function computeRoleRelevance(leadRole: string, targetRole: string): number {
  const normLead = normalize(leadRole);
  const normTarget = normalize(targetRole);

  if (!normLead || !normTarget) return 0;

  // Exact match
  if (normLead === normTarget) return 30;

  // One contains the other (e.g. "VP of Engineering" contains "engineering")
  if (normLead.includes(normTarget) || normTarget.includes(normLead)) return 20;

  // Word-level overlap
  const leadWords = new Set(normLead.split(/\s+/));
  const targetWords = normTarget.split(/\s+/);
  const overlap = targetWords.filter((w) => leadWords.has(w)).length;

  if (overlap > 0) {
    // Scale: at least one shared word → 10, more shared words → up to 15
    return Math.min(15, 10 + overlap * 2);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Intent Signals (0–30)
// ---------------------------------------------------------------------------

function computeIntentSignals(enrichmentData: ScoringInput['lead']['enrichmentData']): number {
  if (!enrichmentData) return 0;

  let score = 0;

  // LinkedIn bio available: 10 points
  if (enrichmentData.linkedinBio && enrichmentData.linkedinBio.trim().length > 0) {
    score += 10;
  }

  // Recent posts available: 10 points
  if (
    enrichmentData.recentPosts &&
    enrichmentData.recentPosts.length > 0 &&
    enrichmentData.recentPosts.some((p) => p.trim().length > 0)
  ) {
    score += 10;
  }

  // Company info available: 10 points
  if (enrichmentData.companyInfo && enrichmentData.companyInfo.trim().length > 0) {
    score += 10;
  }

  return Math.min(30, score);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * When clamping changes the raw total, redistribute the breakdown proportionally
 * so that icpMatch + roleRelevance + intentSignals === totalScore exactly.
 */
function adjustBreakdown(
  icpMatch: number,
  roleRelevance: number,
  intentSignals: number,
  totalScore: number,
): ScoringOutput {
  const rawTotal = icpMatch + roleRelevance + intentSignals;

  if (rawTotal === 0) {
    // Edge case: all components are 0 but totalScore is 1 (clamped minimum)
    return {
      totalScore,
      breakdown: { icpMatch: 1, roleRelevance: 0, intentSignals: 0 },
    };
  }

  const ratio = totalScore / rawTotal;

  let adjIcp = Math.round(icpMatch * ratio);
  let adjRole = Math.round(roleRelevance * ratio);
  let adjIntent = Math.round(intentSignals * ratio);

  // Clamp each to its valid range
  adjIcp = Math.max(0, Math.min(40, adjIcp));
  adjRole = Math.max(0, Math.min(30, adjRole));
  adjIntent = Math.max(0, Math.min(30, adjIntent));

  // Fix rounding drift so the sum is exact
  const diff = totalScore - (adjIcp + adjRole + adjIntent);
  if (diff !== 0) {
    // Apply the difference to the largest component that has room
    const components = [
      { key: 'icpMatch' as const, val: adjIcp, max: 40 },
      { key: 'roleRelevance' as const, val: adjRole, max: 30 },
      { key: 'intentSignals' as const, val: adjIntent, max: 30 },
    ].sort((a, b) => b.val - a.val);

    for (const c of components) {
      const adjusted = c.val + diff;
      if (adjusted >= 0 && adjusted <= c.max) {
        if (c.key === 'icpMatch') adjIcp = adjusted;
        else if (c.key === 'roleRelevance') adjRole = adjusted;
        else adjIntent = adjusted;
        break;
      }
    }
  }

  return {
    totalScore,
    breakdown: { icpMatch: adjIcp, roleRelevance: adjRole, intentSignals: adjIntent },
  };
}

// ===========================================================================
// V2 Scoring — Multi-ICP with painPointRelevance
// ===========================================================================

/**
 * V2 scoring function for multi-ICP system.
 *
 * Score breakdown:
 *   icpMatch            (0–25): industry, geography, company stage match against ICPProfile
 *   roleRelevance       (0–25): how closely the lead's role matches the profile target role
 *   intentSignals       (0–30): availability of enrichment data
 *   painPointRelevance  (0–20): keyword matches between enrichment data and profile pain points
 *
 * Total is clamped to [1, 100] and breakdown always sums to totalScore.
 */
export function calculateLeadScoreV2(input: ScoringInputV2): ScoringOutputV2 {
  const { lead, icpProfile } = input;

  const icpMatch = computeICPMatchV2(lead, icpProfile);
  const roleRelevance = computeRoleRelevanceV2(lead.role, icpProfile.targetRole);
  const intentSignals = computeIntentSignals(lead.enrichmentData);
  const painPointRelevance = computePainPointRelevance(lead.enrichmentData, icpProfile.painPoints);

  const rawTotal = icpMatch + roleRelevance + intentSignals + painPointRelevance;
  const totalScore = Math.max(1, Math.min(100, rawTotal));

  if (totalScore !== rawTotal) {
    return adjustBreakdownV2(
      icpMatch,
      roleRelevance,
      intentSignals,
      painPointRelevance,
      totalScore,
    );
  }

  return {
    totalScore,
    breakdown: { icpMatch, roleRelevance, intentSignals, painPointRelevance },
  };
}

// ---------------------------------------------------------------------------
// ICP Match V2 (0–25) — scaled from V1's 0–40
// ---------------------------------------------------------------------------

function computeICPMatchV2(lead: ScoringInputV2['lead'], profile: ICPProfile): number {
  let score = 0;

  // Industry match: 12 points
  if (lead.industry && profile.industry) {
    if (normalize(lead.industry) === normalize(profile.industry)) {
      score += 12;
    }
  }

  // Geography match: 8 points
  if (lead.geography && profile.geography) {
    if (normalize(lead.geography) === normalize(profile.geography)) {
      score += 8;
    }
  }

  // Company stage match: 5 points
  if (profile.companyStage && lead.company) {
    if (normalize(lead.company).includes(normalize(profile.companyStage))) {
      score += 5;
    }
  }

  return Math.min(25, score);
}

// ---------------------------------------------------------------------------
// Role Relevance V2 (0–25) — scaled from V1's 0–30
// ---------------------------------------------------------------------------

function computeRoleRelevanceV2(leadRole: string, targetRole: string): number {
  const normLead = normalize(leadRole);
  const normTarget = normalize(targetRole);

  if (!normLead || !normTarget) return 0;

  // Exact match
  if (normLead === normTarget) return 25;

  // One contains the other
  if (normLead.includes(normTarget) || normTarget.includes(normLead)) return 17;

  // Word-level overlap
  const leadWords = new Set(normLead.split(/\s+/));
  const targetWords = normTarget.split(/\s+/);
  const overlap = targetWords.filter((w) => leadWords.has(w)).length;

  if (overlap > 0) {
    return Math.min(12, 8 + overlap * 2);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Pain Point Relevance (0–20)
// ---------------------------------------------------------------------------

/**
 * Analyzes lead enrichment data for mentions of the ICP profile's pain points.
 * Uses keyword matching with normalization.
 *
 * Awards up to 20 points based on the number of pain points matched.
 * Returns 0 if no enrichment data or no pain point matches.
 */
function computePainPointRelevance(
  enrichmentData: ScoringInputV2['lead']['enrichmentData'],
  painPoints: string[],
): number {
  if (!enrichmentData || !painPoints || painPoints.length === 0) return 0;

  // Collect all text from enrichment data into a single searchable corpus
  const textParts: string[] = [];

  if (enrichmentData.linkedinBio) {
    textParts.push(enrichmentData.linkedinBio);
  }
  if (enrichmentData.recentPosts) {
    textParts.push(...enrichmentData.recentPosts);
  }
  if (enrichmentData.companyInfo) {
    textParts.push(enrichmentData.companyInfo);
  }

  if (textParts.length === 0) return 0;

  const corpus = normalize(textParts.join(' '));
  if (!corpus) return 0;

  // Count how many pain points have at least one keyword match in the corpus
  let matchedCount = 0;

  for (const painPoint of painPoints) {
    const keywords = extractKeywords(painPoint);
    if (keywords.length === 0) continue;

    // A pain point is considered matched if any of its keywords appear in the corpus
    const hasMatch = keywords.some((keyword) => corpus.includes(keyword));
    if (hasMatch) {
      matchedCount++;
    }
  }

  if (matchedCount === 0) return 0;

  // Scale: proportion of pain points matched × 20, rounded
  const matchRatio = matchedCount / painPoints.length;
  return Math.min(20, Math.round(matchRatio * 20));
}

/**
 * Extracts meaningful keywords from a pain point string.
 * Filters out common stop words and short words.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'the',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'shall',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'as',
    'into',
    'through',
    'during',
    'before',
    'after',
    'above',
    'below',
    'between',
    'out',
    'off',
    'over',
    'under',
    'again',
    'further',
    'then',
    'once',
    'and',
    'but',
    'or',
    'nor',
    'not',
    'so',
    'yet',
    'both',
    'each',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'only',
    'own',
    'same',
    'than',
    'too',
    'very',
    'just',
    'because',
    'about',
    'up',
    'that',
    'this',
    'these',
    'those',
    'it',
    'its',
    'they',
    'them',
    'their',
    'we',
    'our',
    'you',
    'your',
    'he',
    'she',
    'his',
    'her',
    'who',
    'which',
    'what',
    'when',
    'where',
    'how',
    'all',
    'any',
    'if',
    'while',
  ]);

  return normalize(text)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

// ---------------------------------------------------------------------------
// V2 Breakdown Adjustment
// ---------------------------------------------------------------------------

/**
 * When clamping changes the raw total, redistribute the V2 breakdown proportionally
 * so that all components sum to totalScore exactly.
 */
function adjustBreakdownV2(
  icpMatch: number,
  roleRelevance: number,
  intentSignals: number,
  painPointRelevance: number,
  totalScore: number,
): ScoringOutputV2 {
  const rawTotal = icpMatch + roleRelevance + intentSignals + painPointRelevance;

  if (rawTotal === 0) {
    return {
      totalScore,
      breakdown: { icpMatch: 1, roleRelevance: 0, intentSignals: 0, painPointRelevance: 0 },
    };
  }

  const ratio = totalScore / rawTotal;

  let adjIcp = Math.round(icpMatch * ratio);
  let adjRole = Math.round(roleRelevance * ratio);
  let adjIntent = Math.round(intentSignals * ratio);
  let adjPain = Math.round(painPointRelevance * ratio);

  adjIcp = Math.max(0, Math.min(25, adjIcp));
  adjRole = Math.max(0, Math.min(25, adjRole));
  adjIntent = Math.max(0, Math.min(30, adjIntent));
  adjPain = Math.max(0, Math.min(20, adjPain));

  const diff = totalScore - (adjIcp + adjRole + adjIntent + adjPain);
  if (diff !== 0) {
    const components = [
      { key: 'icpMatch' as const, val: adjIcp, max: 25 },
      { key: 'roleRelevance' as const, val: adjRole, max: 25 },
      { key: 'intentSignals' as const, val: adjIntent, max: 30 },
      { key: 'painPointRelevance' as const, val: adjPain, max: 20 },
    ].sort((a, b) => b.val - a.val);

    for (const c of components) {
      const adjusted = c.val + diff;
      if (adjusted >= 0 && adjusted <= c.max) {
        if (c.key === 'icpMatch') adjIcp = adjusted;
        else if (c.key === 'roleRelevance') adjRole = adjusted;
        else if (c.key === 'intentSignals') adjIntent = adjusted;
        else adjPain = adjusted;
        break;
      }
    }
  }

  return {
    totalScore,
    breakdown: {
      icpMatch: adjIcp,
      roleRelevance: adjRole,
      intentSignals: adjIntent,
      painPointRelevance: adjPain,
    },
  };
}
