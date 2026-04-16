// ============================================================
// Personalization Context Builder
// ============================================================
//
// Assembles the full PersonalizationContext for message generation
// by computing intersection analysis between ICP pain points and
// prospect challenges using OpenAI embeddings for semantic similarity.
//
// Requirements: 4.1, 4.5
// ============================================================

import type {
  ContentSummary,
  EnrichedICP,
  IntersectionAnalysis,
  PainPointMatch,
  PersonalizationContext,
  ResearchActivity,
  ResearchProfile,
} from '@/types';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton — same pattern as correlationEngineService)
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

// ---------------------------------------------------------------------------
// Intersection Analysis
// ---------------------------------------------------------------------------

/**
 * Compute the intersection analysis between ICP pain points and prospect
 * challenges using OpenAI embeddings for semantic similarity.
 *
 * For each ICP pain point, finds the best-matching prospect challenge and
 * records the pair with its similarity score. Falls back to keyword-based
 * matching if embeddings fail.
 */
export async function computeIntersectionAnalysis(
  icpPainPoints: string[],
  prospectChallenges: string[],
): Promise<IntersectionAnalysis> {
  if (icpPainPoints.length === 0 || prospectChallenges.length === 0) {
    return { painPointMatches: [], overallRelevanceScore: 0 };
  }

  let painPointMatches: PainPointMatch[];

  try {
    painPointMatches = await computeMatchesWithEmbeddings(icpPainPoints, prospectChallenges);
  } catch (error) {
    console.warn(
      '[PersonalizationContextBuilder] OpenAI embedding failed, falling back to keyword matching:',
      error instanceof Error ? error.message : String(error),
    );
    painPointMatches = computeMatchesWithKeywords(icpPainPoints, prospectChallenges);
  }

  const overallRelevanceScore =
    painPointMatches.length > 0
      ? painPointMatches.reduce((sum, m) => sum + m.similarityScore, 0) / painPointMatches.length
      : 0;

  return {
    painPointMatches,
    overallRelevanceScore: Math.max(0, Math.min(1, overallRelevanceScore)),
  };
}

/**
 * Compute pain point matches using OpenAI embeddings and cosine similarity.
 */
async function computeMatchesWithEmbeddings(
  icpPainPoints: string[],
  prospectChallenges: string[],
): Promise<PainPointMatch[]> {
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

  const matches: PainPointMatch[] = [];

  for (let i = 0; i < icpPainPoints.length; i++) {
    let bestSim = 0;
    let bestChallengeIdx = 0;

    for (let j = 0; j < prospectChallenges.length; j++) {
      const sim = cosineSimilarity(icpEmbeddings[i], challengeEmbeddings[j]);
      if (sim > bestSim) {
        bestSim = sim;
        bestChallengeIdx = j;
      }
    }

    matches.push({
      founderPainPoint: icpPainPoints[i],
      prospectChallenge: prospectChallenges[bestChallengeIdx],
      similarityScore: Math.max(0, Math.min(1, bestSim)),
    });
  }

  return matches;
}

/**
 * Keyword-based fallback for pain point matching.
 * Computes word-level overlap between each ICP pain point and prospect challenges.
 */
function computeMatchesWithKeywords(
  icpPainPoints: string[],
  prospectChallenges: string[],
): PainPointMatch[] {
  const matches: PainPointMatch[] = [];

  for (const painPoint of icpPainPoints) {
    const painWords = new Set(
      painPoint
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

    let bestScore = 0;
    let bestChallenge = prospectChallenges[0];

    for (const challenge of prospectChallenges) {
      const challengeWords = challenge
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      if (challengeWords.length === 0) continue;

      const overlap = challengeWords.filter((w) => painWords.has(w)).length;
      const score = overlap / Math.max(painWords.size, challengeWords.length);

      if (score > bestScore) {
        bestScore = score;
        bestChallenge = challenge;
      }
    }

    matches.push({
      founderPainPoint: painPoint,
      prospectChallenge: bestChallenge,
      similarityScore: Math.max(0, Math.min(1, bestScore)),
    });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Content Selection
// ---------------------------------------------------------------------------

/**
 * Select the most recent activity within the specified age threshold.
 * Returns null if no activity falls within the threshold.
 *
 * Requirements: 4.5
 */
export function selectRecentContent(
  activities: ResearchActivity[],
  maxAgeDays: number,
): ResearchActivity | null {
  if (activities.length === 0) return null;

  const now = Date.now();
  const thresholdMs = maxAgeDays * 24 * 60 * 60 * 1000;

  let bestActivity: ResearchActivity | null = null;
  let bestTimestamp = -Infinity;

  for (const activity of activities) {
    const ts = new Date(activity.timestamp).getTime();
    const ageMs = now - ts;

    if (ageMs <= thresholdMs && ts > bestTimestamp) {
      bestTimestamp = ts;
      bestActivity = activity;
    }
  }

  return bestActivity;
}

/**
 * Select the pain point match with the highest similarity score.
 * Returns null if the matches array is empty.
 */
export function selectBestPainPointMatch(matches: PainPointMatch[]): PainPointMatch | null {
  if (matches.length === 0) return null;

  let best = matches[0];
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].similarityScore > best.similarityScore) {
      best = matches[i];
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// ContentSummary Parsing & Selection
// ---------------------------------------------------------------------------

/**
 * Attempt to parse a `publishedContentSummaries` entry as a ContentSummary.
 * Returns `null` for legacy plain strings or invalid JSON.
 *
 * Requirements: 4.4, 4.5
 */
export function parseContentSummary(entry: string): ContentSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Validate all required fields exist with correct types
  if (typeof obj.synopsis !== 'string') return null;
  if (!Array.isArray(obj.keyPoints) || !obj.keyPoints.every((v: unknown) => typeof v === 'string'))
    return null;
  if (
    !Array.isArray(obj.notableQuotes) ||
    !obj.notableQuotes.every((v: unknown) => typeof v === 'string')
  )
    return null;
  if (!Array.isArray(obj.opinions) || !obj.opinions.every((v: unknown) => typeof v === 'string'))
    return null;
  if (!Array.isArray(obj.topics) || !obj.topics.every((v: unknown) => typeof v === 'string'))
    return null;
  if (typeof obj.sourceUrl !== 'string') return null;

  return {
    synopsis: obj.synopsis,
    keyPoints: obj.keyPoints as string[],
    notableQuotes: obj.notableQuotes as string[],
    opinions: obj.opinions as string[],
    topics: obj.topics as string[],
    sourceUrl: obj.sourceUrl,
  };
}

/**
 * Select the ContentSummary with the highest topic overlap with ICP pain points.
 * Uses case-insensitive comparison. Returns the first summary if no overlap exists
 * or there is a tie.
 *
 * Requirements: 4.3
 */
export function selectRelevantContent(
  summaries: ContentSummary[],
  icpPainPoints: string[],
): ContentSummary | null {
  if (summaries.length === 0) return null;

  const painPointsLower = icpPainPoints.map((p) => p.toLowerCase());

  let bestSummary = summaries[0];
  let bestOverlap = 0;

  for (const summary of summaries) {
    const topicsLower = summary.topics.map((t) => t.toLowerCase());
    let overlap = 0;
    for (const topic of topicsLower) {
      for (const painPoint of painPointsLower) {
        if (topic === painPoint) {
          overlap++;
          break;
        }
      }
    }

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSummary = summary;
    }
  }

  return bestSummary;
}

// ---------------------------------------------------------------------------
// Core: Build Personalization Context
// ---------------------------------------------------------------------------

const DEFAULT_MAX_AGE_DAYS = 30;

/**
 * Assemble the full PersonalizationContext for message generation.
 *
 * Computes the intersection analysis between the Enriched ICP's pain points
 * and the prospect's challenges, selects the most recent content reference
 * (within 30 days), picks the best pain point match, and parses any
 * ContentSummary JSON from publishedContentSummaries.
 *
 * Requirements: 4.1, 4.3, 4.4, 4.5
 */
export async function buildPersonalizationContext(
  enrichedICP: EnrichedICP,
  researchProfile: ResearchProfile,
): Promise<PersonalizationContext> {
  const intersectionAnalysis = await computeIntersectionAnalysis(
    enrichedICP.painPointsSolved ?? [],
    researchProfile.currentChallenges,
  );

  const recentContentReference = selectRecentContent(
    researchProfile.recentActivity,
    DEFAULT_MAX_AGE_DAYS,
  );

  const painPointReference = selectBestPainPointMatch(intersectionAnalysis.painPointMatches);

  // Parse ContentSummary JSON from publishedContentSummaries (legacy strings return null)
  const contentSummaries: ContentSummary[] = [];
  for (const entry of researchProfile.publishedContentSummaries) {
    const parsed = parseContentSummary(entry);
    if (parsed) {
      contentSummaries.push(parsed);
    }
  }

  // Select the most relevant ContentSummary based on topic overlap with ICP pain points
  const selectedContentDetail =
    selectRelevantContent(contentSummaries, enrichedICP.painPointsSolved ?? []) ?? undefined;

  return {
    enrichedICP,
    researchProfile,
    intersectionAnalysis,
    recentContentReference,
    painPointReference,
    contentSummaries,
    selectedContentDetail,
  };
}
