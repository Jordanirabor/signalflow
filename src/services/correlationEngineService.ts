// ============================================================
// Correlation Engine Service
// ============================================================
//
// Computes semantic correlation scores between prospects and the
// Enriched ICP across four dimensions: role fit, industry alignment,
// pain point overlap, and buying signal strength.
//
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.1–7.5
// ============================================================

import { query } from '@/lib/db';
import type {
  CorrelationBreakdown,
  CorrelationScore,
  EnrichedICP,
  Lead,
  ResearchActivity,
  ResearchProfile,
} from '@/types';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CORRELATION_WEIGHTS = {
  roleFit: 0.25,
  industryAlignment: 0.25,
  painPointOverlap: 0.35,
  buyingSignalStrength: 0.15,
} as const;

const LOW_CORRELATION_THRESHOLD = 0.3;

// Purchase-intent keywords used by the buying signal scorer
const BUYING_SIGNAL_KEYWORDS = [
  'evaluating',
  'looking for',
  'searching for',
  'comparing',
  'considering',
  'need a solution',
  'pain point',
  'challenge',
  'struggling with',
  'hiring',
  'budget',
  'roi',
  'demo',
  'trial',
  'pricing',
  'vendor',
  'rfp',
  'implementation',
  'migration',
  'upgrade',
];

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton — same pattern as icpService)
// ---------------------------------------------------------------------------

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/** Exposed for testing — allows injecting a mock client. */
export function setOpenAIClient(client: OpenAI | null): void {
  openaiClient = client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a value to [0.0, 1.0], treating NaN/Infinity as 0.0. */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0.0;
  return Math.max(0.0, Math.min(1.0, value));
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Dimension Scorers
// ---------------------------------------------------------------------------

/**
 * Role Fit (weight: 0.25)
 *
 * Reuses the logic from scoringService.ts `computeRoleRelevance` but
 * scaled to 0.0–1.0 instead of 0–30.
 */
export function computeRoleFit(prospectRole: string, icpTargetRole: string): number {
  const normProspect = normalize(prospectRole);
  const normTarget = normalize(icpTargetRole);

  if (!normProspect || !normTarget) return 0.0;

  // Exact match
  if (normProspect === normTarget) return 1.0;

  // One contains the other (e.g. "VP of Engineering" contains "engineering")
  if (normProspect.includes(normTarget) || normTarget.includes(normProspect)) {
    return 20 / 30; // ≈ 0.667
  }

  // Word-level overlap
  const prospectWords = new Set(normProspect.split(/\s+/));
  const targetWords = normTarget.split(/\s+/);
  const overlap = targetWords.filter((w) => prospectWords.has(w)).length;

  if (overlap > 0) {
    const rawScore = Math.min(15, 10 + overlap * 2);
    return rawScore / 30;
  }

  return 0.0;
}

/**
 * Industry Alignment (weight: 0.25)
 *
 * exact match = 1.0, partial/related = 0.5, no match = 0.0
 */
export function computeIndustryAlignment(
  prospectIndustry: string | undefined,
  icpIndustry: string,
): number {
  if (!prospectIndustry || !icpIndustry) return 0.0;

  const normProspect = normalize(prospectIndustry);
  const normICP = normalize(icpIndustry);

  if (!normProspect || !normICP) return 0.0;

  // Exact match
  if (normProspect === normICP) return 1.0;

  // Partial match: one contains the other
  if (normProspect.includes(normICP) || normICP.includes(normProspect)) return 0.5;

  // Word-level overlap for related industries (e.g. "financial technology" vs "fintech")
  const prospectWords = new Set(normProspect.split(/\s+/));
  const icpWords = normICP.split(/\s+/);
  const overlap = icpWords.filter((w) => prospectWords.has(w)).length;
  if (overlap > 0) return 0.5;

  return 0.0;
}

/**
 * Pain Point Overlap (weight: 0.35)
 *
 * Uses OpenAI embeddings to compute cosine similarity between prospect
 * challenges and ICP pain points. Falls back to keyword-based matching
 * if embeddings fail.
 */
export async function computePainPointOverlap(
  prospectChallenges: string[],
  icpPainPoints: string[],
): Promise<number> {
  if (prospectChallenges.length === 0 || icpPainPoints.length === 0) return 0.0;

  try {
    return await computePainPointOverlapWithEmbeddings(prospectChallenges, icpPainPoints);
  } catch (error) {
    console.warn(
      '[CorrelationEngine] OpenAI embedding failed, falling back to keyword matching:',
      error instanceof Error ? error.message : String(error),
    );
    return computePainPointOverlapKeywordFallback(prospectChallenges, icpPainPoints);
  }
}

/**
 * Compute pain point overlap using OpenAI embeddings and cosine similarity.
 */
async function computePainPointOverlapWithEmbeddings(
  prospectChallenges: string[],
  icpPainPoints: string[],
): Promise<number> {
  const client = getOpenAIClient();

  // Get embeddings for all texts in a single batch
  const allTexts = [...icpPainPoints, ...prospectChallenges];
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: allTexts,
  });

  const embeddings = response.data.map((d) => d.embedding);
  const icpEmbeddings = embeddings.slice(0, icpPainPoints.length);
  const challengeEmbeddings = embeddings.slice(icpPainPoints.length);

  // For each ICP pain point, find the highest cosine similarity with any prospect challenge
  let totalSimilarity = 0;
  for (const icpEmb of icpEmbeddings) {
    let maxSim = 0;
    for (const chalEmb of challengeEmbeddings) {
      const sim = cosineSimilarity(icpEmb, chalEmb);
      if (sim > maxSim) maxSim = sim;
    }
    totalSimilarity += maxSim;
  }

  // Average across all ICP pain points
  return clampScore(totalSimilarity / icpPainPoints.length);
}

/**
 * Keyword-based fallback for pain point overlap.
 * Computes word-level overlap between challenges and pain points.
 */
export function computePainPointOverlapKeywordFallback(
  prospectChallenges: string[],
  icpPainPoints: string[],
): number {
  if (prospectChallenges.length === 0 || icpPainPoints.length === 0) return 0.0;

  const challengeWords = new Set(
    prospectChallenges.flatMap((c) =>
      normalize(c)
        .split(/\s+/)
        .filter((w) => w.length > 2),
    ),
  );

  let matchedPainPoints = 0;
  for (const painPoint of icpPainPoints) {
    const painWords = normalize(painPoint)
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const overlap = painWords.filter((w) => challengeWords.has(w)).length;
    if (overlap > 0) matchedPainPoints++;
  }

  return clampScore(matchedPainPoints / icpPainPoints.length);
}

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dotProduct / denom;
}

/**
 * Buying Signal Strength (weight: 0.15)
 *
 * Scores based on recency and volume of purchase-intent signals
 * in the prospect's recent activity.
 */
export function computeBuyingSignalStrength(recentActivity: ResearchActivity[]): number {
  if (recentActivity.length === 0) return 0.0;

  const now = Date.now();
  let signalScore = 0;
  let signalCount = 0;

  for (const activity of recentActivity) {
    const text = normalize(activity.summary);
    const hasSignal = BUYING_SIGNAL_KEYWORDS.some((kw) => text.includes(kw));
    if (!hasSignal) continue;

    signalCount++;

    // Recency bonus: activities within 7 days get full weight,
    // 7–30 days get 0.7, 30–90 days get 0.4, older get 0.1
    const ageMs = now - new Date(activity.timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    let recencyWeight: number;
    if (ageDays <= 7) recencyWeight = 1.0;
    else if (ageDays <= 30) recencyWeight = 0.7;
    else if (ageDays <= 90) recencyWeight = 0.4;
    else recencyWeight = 0.1;

    signalScore += recencyWeight;
  }

  if (signalCount === 0) return 0.0;

  // Normalize: 1 signal → 0.3, 2 → 0.5, 3 → 0.7, 4+ → up to 1.0
  // Using a diminishing returns formula
  const volumeScore = Math.min(1.0, 0.3 + (signalCount - 1) * 0.2);

  // Combine volume and average recency
  const avgRecency = signalScore / signalCount;
  return clampScore(volumeScore * avgRecency);
}

// ---------------------------------------------------------------------------
// Core: Compute Correlation Score
// ---------------------------------------------------------------------------

/**
 * Compute the weighted correlation score for a prospect against the Enriched ICP.
 *
 * Weights: roleFit 0.25, industryAlignment 0.25, painPointOverlap 0.35, buyingSignalStrength 0.15
 */
export async function computeCorrelationScore(
  prospect: Lead,
  researchProfile: ResearchProfile,
  enrichedICP: EnrichedICP,
): Promise<CorrelationScore> {
  // Compute each dimension
  const roleFit = clampScore(computeRoleFit(prospect.role, enrichedICP.targetRole));
  const industryAlignment = clampScore(
    computeIndustryAlignment(prospect.industry, enrichedICP.industry),
  );
  const painPointOverlap = clampScore(
    await computePainPointOverlap(
      researchProfile.currentChallenges,
      enrichedICP.painPointsSolved ?? [],
    ),
  );
  const buyingSignalStrength = clampScore(
    computeBuyingSignalStrength(researchProfile.recentActivity),
  );

  const breakdown: CorrelationBreakdown = {
    roleFit,
    industryAlignment,
    painPointOverlap,
    buyingSignalStrength,
  };

  // Weighted sum
  const total = clampScore(
    CORRELATION_WEIGHTS.roleFit * breakdown.roleFit +
      CORRELATION_WEIGHTS.industryAlignment * breakdown.industryAlignment +
      CORRELATION_WEIGHTS.painPointOverlap * breakdown.painPointOverlap +
      CORRELATION_WEIGHTS.buyingSignalStrength * breakdown.buyingSignalStrength,
  );

  return { total, breakdown };
}

/**
 * Compute the weighted total from pre-computed dimension scores.
 * Useful for property testing where dimension scores are provided directly.
 */
export function computeWeightedTotal(breakdown: CorrelationBreakdown): number {
  return clampScore(
    CORRELATION_WEIGHTS.roleFit * clampScore(breakdown.roleFit) +
      CORRELATION_WEIGHTS.industryAlignment * clampScore(breakdown.industryAlignment) +
      CORRELATION_WEIGHTS.painPointOverlap * clampScore(breakdown.painPointOverlap) +
      CORRELATION_WEIGHTS.buyingSignalStrength * clampScore(breakdown.buyingSignalStrength),
  );
}

/**
 * Determine the correlation flag based on the total score.
 * Returns "low_correlation" if score < 0.3, otherwise null.
 */
export function determineCorrelationFlag(totalScore: number): string | null {
  return totalScore < LOW_CORRELATION_THRESHOLD ? 'low_correlation' : null;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Store the correlation score, breakdown, and flag on the lead record.
 */
async function storeCorrelationScore(
  leadId: string,
  score: CorrelationScore,
  flag: string | null,
): Promise<void> {
  await query(
    `UPDATE lead
     SET correlation_score = $1,
         correlation_breakdown = $2,
         correlation_flag = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [score.total, JSON.stringify(score.breakdown), flag, leadId],
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute and persist the correlation score for a single prospect.
 * Returns the computed score.
 */
export async function scoreAndStoreCorrelation(
  prospect: Lead,
  researchProfile: ResearchProfile,
  enrichedICP: EnrichedICP,
): Promise<CorrelationScore> {
  const score = await computeCorrelationScore(prospect, researchProfile, enrichedICP);
  const flag = determineCorrelationFlag(score.total);

  await storeCorrelationScore(prospect.id, score, flag);

  console.log(
    `[CorrelationEngine] Scored lead "${prospect.name}": ${score.total.toFixed(3)} ` +
      `(roleFit=${score.breakdown.roleFit.toFixed(2)}, ` +
      `industry=${score.breakdown.industryAlignment.toFixed(2)}, ` +
      `painPoint=${score.breakdown.painPointOverlap.toFixed(2)}, ` +
      `buyingSignal=${score.breakdown.buyingSignalStrength.toFixed(2)})` +
      (flag ? ` [${flag}]` : ''),
  );

  return score;
}

/**
 * Recalculate correlation scores for all leads belonging to a founder.
 * Used when the Enriched ICP is updated.
 *
 * Requirements: 3.7
 */
export async function recalculateCorrelationScores(founderId: string): Promise<void> {
  // Fetch the enriched ICP for this founder
  const icpResult = await query<{
    id: string;
    founder_id: string;
    target_role: string;
    industry: string;
    company_stage: string | null;
    geography: string | null;
    custom_tags: string[] | null;
    product_description: string | null;
    value_proposition: string | null;
    pain_points_solved: string[] | null;
    competitor_context: string | null;
    ideal_customer_characteristics: string | null;
    enrichment_generated_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, founder_id, target_role, industry, company_stage, geography, custom_tags,
            product_description, value_proposition, pain_points_solved, competitor_context,
            ideal_customer_characteristics, enrichment_generated_at, created_at, updated_at
     FROM icp WHERE founder_id = $1 LIMIT 1`,
    [founderId],
  );

  if (icpResult.rows.length === 0) {
    console.warn(
      `[CorrelationEngine] No ICP found for founder ${founderId}, skipping recalculation.`,
    );
    return;
  }

  const icpRow = icpResult.rows[0];
  const enrichedICP: EnrichedICP = {
    id: icpRow.id,
    founderId: icpRow.founder_id,
    targetRole: icpRow.target_role,
    industry: icpRow.industry,
    companyStage: icpRow.company_stage ?? undefined,
    geography: icpRow.geography ?? undefined,
    customTags: icpRow.custom_tags ?? undefined,
    productDescription: icpRow.product_description ?? undefined,
    valueProposition: icpRow.value_proposition ?? undefined,
    painPointsSolved: icpRow.pain_points_solved ?? undefined,
    competitorContext: icpRow.competitor_context ?? undefined,
    idealCustomerCharacteristics: icpRow.ideal_customer_characteristics ?? undefined,
    enrichmentGeneratedAt: icpRow.enrichment_generated_at ?? undefined,
    createdAt: icpRow.created_at,
    updatedAt: icpRow.updated_at,
  };

  // Fetch all non-deleted leads for this founder that have a research profile
  const leadsResult = await query<{
    id: string;
    founder_id: string;
    name: string;
    role: string;
    company: string;
    industry: string | null;
    geography: string | null;
    lead_score: number;
    score_breakdown: ScoreBreakdownRow;
    enrichment_status: string;
    enrichment_data: Record<string, unknown> | null;
    research_profile: ResearchProfile | null;
    crm_status: string;
    is_deleted: boolean;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, founder_id, name, role, company, industry, geography,
            lead_score, score_breakdown, enrichment_status, enrichment_data,
            research_profile, crm_status, is_deleted, deleted_at, created_at, updated_at
     FROM lead
     WHERE founder_id = $1 AND is_deleted = false`,
    [founderId],
  );

  console.log(
    `[CorrelationEngine] Recalculating correlation scores for ${leadsResult.rows.length} leads (founder: ${founderId})`,
  );

  for (const row of leadsResult.rows) {
    const lead: Lead = {
      id: row.id,
      founderId: row.founder_id,
      name: row.name,
      role: row.role,
      company: row.company,
      industry: row.industry ?? undefined,
      geography: row.geography ?? undefined,
      leadScore: row.lead_score,
      scoreBreakdown: row.score_breakdown as unknown as Lead['scoreBreakdown'],
      enrichmentStatus: row.enrichment_status as Lead['enrichmentStatus'],
      enrichmentData: row.enrichment_data as unknown as Lead['enrichmentData'],
      crmStatus: row.crm_status as Lead['crmStatus'],
      isDeleted: row.is_deleted,
      deletedAt: row.deleted_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    // Build a research profile — use stored one or create an empty one
    let researchProfile: ResearchProfile;
    if (row.research_profile) {
      const raw = row.research_profile;
      researchProfile = {
        ...raw,
        researchedAt: new Date(raw.researchedAt),
        recentActivity: (raw.recentActivity ?? []).map((a) => ({
          ...a,
          timestamp: new Date(a.timestamp),
        })),
      };
    } else {
      researchProfile = {
        leadId: lead.id,
        topicsOfInterest: [],
        currentChallenges: [],
        recentActivity: [],
        publishedContentSummaries: [],
        overallSentiment: 'neutral',
        sourcesUsed: [],
        sourcesUnavailable: [],
        researchedAt: new Date(),
      };
    }

    try {
      await scoreAndStoreCorrelation(lead, researchProfile, enrichedICP);
    } catch (error) {
      console.error(
        `[CorrelationEngine] Failed to recalculate score for lead "${lead.name}" (${lead.id}):`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log(`[CorrelationEngine] Recalculation complete for founder ${founderId}.`);
}

// Internal type for score_breakdown column
interface ScoreBreakdownRow {
  icpMatch: number;
  roleRelevance: number;
  intentSignals: number;
}
