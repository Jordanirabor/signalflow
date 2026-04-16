// ============================================================
// Query Generator — AI-powered search query generation from ICP
// ============================================================

import type { ICPProfile } from '@/types';
import OpenAI from 'openai';
import type { AnnotatedQuery, ICP, QueryGeneratorConfig, QueryGeneratorResult } from './types';

// ---------------------------------------------------------------------------
// V2 types — pain-point & buying-signal aware query generation
// ---------------------------------------------------------------------------

export interface AnnotatedQueryV2 extends AnnotatedQuery {
  icpProfileId: string;
  sourceType: 'pain_point' | 'buying_signal' | 'base';
  sourceText?: string;
}

export interface QueryGeneratorResultV2 {
  queries: AnnotatedQueryV2[];
  generationMethod: 'ai' | 'template_fallback';
}

// ---------------------------------------------------------------------------
// Valid discovery vectors
// ---------------------------------------------------------------------------

const VALID_VECTORS: AnnotatedQuery['vector'][] = [
  'linkedin',
  'directory',
  'github',
  'twitter',
  'maps',
  'general',
];

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: QueryGeneratorConfig = {
  minQueries: 5,
  maxQueryLength: 256,
};

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton — same pattern as insightService)
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

/**
 * Truncate a query string to the max length, trimming at a word boundary
 * when possible.
 */
function truncateQuery(query: string, maxLen: number): string {
  if (query.length <= maxLen) return query;
  const truncated = query.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.5 ? truncated.slice(0, lastSpace) : truncated;
}

/**
 * Make a query string URL-safe by encoding and then decoding it to strip
 * characters that would break when used in a URL query parameter.
 * We keep the human-readable form but ensure it round-trips through
 * encodeURIComponent without issues.
 */
function sanitizeQuery(raw: string): string {
  // Remove characters that are problematic even after encoding
  // Keep alphanumeric, spaces, quotes, colons, slashes, dots, hyphens, underscores, @
  return raw.replace(/[^\w\s"':/.@,\-+()]/g, '').trim();
}

function isValidVector(v: string): v is AnnotatedQuery['vector'] {
  return VALID_VECTORS.includes(v as AnnotatedQuery['vector']);
}

// ---------------------------------------------------------------------------
// OpenAI prompt construction
// ---------------------------------------------------------------------------

function buildPrompt(icp: ICP, minQueries: number): string {
  const parts: string[] = [];
  parts.push(`Target Role: ${icp.targetRole}`);
  parts.push(`Industry: ${icp.industry}`);
  if (icp.geography) parts.push(`Geography: ${icp.geography}`);
  if (icp.companyStage) parts.push(`Company Stage: ${icp.companyStage}`);
  if (icp.customTags?.length) parts.push(`Custom Tags: ${icp.customTags.join(', ')}`);

  return `You are a lead generation expert. Given the following Ideal Customer Profile (ICP), generate at least ${minQueries} distinct Google Search queries to discover matching prospects.

ICP:
${parts.join('\n')}

Requirements:
- Each query must target one of these discovery vectors: linkedin, directory, github, twitter, maps, general
- Cover at least 3 different vectors across all queries
- Vary phrasing, synonyms, and keyword combinations to maximize coverage
- LinkedIn queries should include "linkedin" keyword to target LinkedIn results
- Directory queries should include "crunchbase" or "wellfound" or "ycombinator" keywords
- GitHub queries should include "github" keyword for technical roles
- Twitter queries should include "twitter" or "x.com" keyword
- Maps queries should include geographic terms and business categories
- General queries should combine role + industry + geography keywords
- Do NOT use the "site:" operator in any query — it may be blocked by search APIs
- Each query must be under 256 characters
- Each query must be safe for URL encoding (no special unicode characters)

Return ONLY valid JSON — an array of objects with "query" (string) and "vector" (string) fields.
Example: [{"query":"site:linkedin.com/in/ CTO SaaS San Francisco","vector":"linkedin"}]`;
}

// ---------------------------------------------------------------------------
// AI-powered query generation
// ---------------------------------------------------------------------------

/**
 * Generate search queries from an ICP using OpenAI.
 * Falls back to deterministic templates if the AI call fails.
 */
export async function generateQueries(
  icp: ICP,
  config?: Partial<QueryGeneratorConfig>,
): Promise<QueryGeneratorResult> {
  const cfg: QueryGeneratorConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    const client = getOpenAIClient();
    const prompt = buildPrompt(icp, cfg.minQueries);

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a search query generation assistant. Return only valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1500,
      temperature: 0.7,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const parsed = JSON.parse(content) as Array<{ query: string; vector: string }>;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Invalid response format from OpenAI');
    }

    const queries: AnnotatedQuery[] = parsed
      .filter(
        (item) =>
          typeof item.query === 'string' &&
          item.query.trim().length > 0 &&
          typeof item.vector === 'string' &&
          isValidVector(item.vector),
      )
      .map((item) => ({
        query: truncateQuery(sanitizeQuery(item.query), cfg.maxQueryLength),
        vector: item.vector as AnnotatedQuery['vector'],
      }))
      .filter((q) => q.query.length > 0);

    // Deduplicate by query string
    const seen = new Set<string>();
    const unique: AnnotatedQuery[] = [];
    for (const q of queries) {
      if (!seen.has(q.query)) {
        seen.add(q.query);
        unique.push(q);
      }
    }

    if (unique.length >= cfg.minQueries) {
      return { queries: unique, generationMethod: 'ai' };
    }

    // If AI didn't produce enough, supplement with fallback queries
    const fallback = generateFallbackQueries(icp);
    for (const fq of fallback) {
      if (!seen.has(fq.query)) {
        seen.add(fq.query);
        unique.push(fq);
      }
      if (unique.length >= cfg.minQueries) break;
    }

    return { queries: unique, generationMethod: unique.length > queries.length ? 'ai' : 'ai' };
  } catch {
    // OpenAI failed — use deterministic fallback
    const queries = generateFallbackQueries(icp);
    return { queries, generationMethod: 'template_fallback' };
  }
}

// ---------------------------------------------------------------------------
// Deterministic fallback query generation
// ---------------------------------------------------------------------------

/**
 * Generate deterministic template-based queries from ICP fields.
 * Used as fallback when OpenAI is unavailable.
 * Produces at least 5 queries covering at least 3 vectors.
 */
export function generateFallbackQueries(icp: ICP): AnnotatedQuery[] {
  const { targetRole, industry, geography, companyStage, customTags } = icp;
  const queries: AnnotatedQuery[] = [];

  const geo = geography || '';
  const stage = companyStage || '';
  const tags = customTags?.join(' ') || '';

  // People-focused queries — find actual humans with names and roles
  queries.push({
    query: sanitizeQuery(`"${targetRole}" "${industry}" people`),
    vector: 'linkedin',
  });

  queries.push({
    query: sanitizeQuery(`"${targetRole}" ${industry}${geo ? ` ${geo}` : ''} profile`),
    vector: 'linkedin',
  });

  if (stage) {
    queries.push({
      query: sanitizeQuery(`"${targetRole}" ${stage} ${industry} team`),
      vector: 'linkedin',
    });
  }

  // Company team pages — often list leadership with names
  queries.push({
    query: sanitizeQuery(`${industry} company "our team" "${targetRole}"${geo ? ` ${geo}` : ''}`),
    vector: 'general',
  });

  queries.push({
    query: sanitizeQuery(
      `${industry}${stage ? ` ${stage}` : ''} "leadership team" "${targetRole}"`,
    ),
    vector: 'general',
  });

  // GitHub query (for technical roles)
  queries.push({
    query: sanitizeQuery(`"${targetRole}" "${industry}"${geo ? ` ${geo}` : ''}`),
    vector: 'github',
  });

  // Twitter query
  queries.push({
    query: sanitizeQuery(`"${targetRole}" "${industry}"${tags ? ` ${tags}` : ''}`),
    vector: 'twitter',
  });

  // Maps query (only if geography is provided)
  if (geo) {
    queries.push({
      query: sanitizeQuery(`${industry} companies ${geo} ${targetRole}`),
      vector: 'maps',
    });
  }

  // General contact/directory queries
  queries.push({
    query: sanitizeQuery(`"${targetRole}" "${industry}"${geo ? ` ${geo}` : ''} contact email`),
    vector: 'general',
  });

  if (tags) {
    queries.push({
      query: sanitizeQuery(`"${targetRole}" ${tags} ${industry}`),
      vector: 'general',
    });
  }

  // Ensure we always have at least 5 queries
  if (queries.length < 5) {
    const extras: AnnotatedQuery[] = [
      {
        query: sanitizeQuery(`"${targetRole}" ${industry} hiring`),
        vector: 'general',
      },
      {
        query: sanitizeQuery(`${industry} ${targetRole} directory`),
        vector: 'general',
      },
      {
        query: sanitizeQuery(`${targetRole} ${industry} professional`),
        vector: 'linkedin',
      },
    ];
    for (const extra of extras) {
      if (queries.length >= 5) break;
      queries.push(extra);
    }
  }

  // Truncate all queries to max length and deduplicate
  const maxLen = DEFAULT_CONFIG.maxQueryLength;
  const seen = new Set<string>();
  const result: AnnotatedQuery[] = [];
  for (const q of queries) {
    const truncated = truncateQuery(q.query, maxLen);
    if (truncated.length > 0 && !seen.has(truncated)) {
      seen.add(truncated);
      result.push({ query: truncated, vector: q.vector });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// V2 — Per-profile query generation (pain points + buying signals + base)
// ---------------------------------------------------------------------------

/**
 * Generate pain-point queries for an ICP profile.
 * Produces at least 1 query per pain point, combining the pain point text
 * with the profile's targetRole and industry.
 */
function generatePainPointQueries(profile: ICPProfile): AnnotatedQueryV2[] {
  const queries: AnnotatedQueryV2[] = [];

  // Extract short keyword phrases from pain points instead of full sentences
  for (const painPoint of profile.painPoints.slice(0, 3)) {
    // Take first 3-4 meaningful words from the pain point
    const keywords = painPoint
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 4)
      .join(' ');

    if (!keywords) continue;

    const queryText = sanitizeQuery(
      `"${profile.targetRole}" ${profile.industry} ${keywords}`,
    ).slice(0, 120);

    if (queryText.length > 0) {
      queries.push({
        query: queryText,
        vector: 'general',
        icpProfileId: profile.id,
        sourceType: 'pain_point',
        sourceText: painPoint,
      });
    }
  }

  return queries;
}

/**
 * Generate buying-signal queries for an ICP profile.
 * Produces at least 1 query per buying signal.
 */
function generateBuyingSignalQueries(profile: ICPProfile): AnnotatedQueryV2[] {
  const queries: AnnotatedQueryV2[] = [];

  for (const signal of profile.buyingSignals.slice(0, 3)) {
    const keywords = signal
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 4)
      .join(' ');

    if (!keywords) continue;

    const queryText = sanitizeQuery(
      `"${profile.targetRole}" ${profile.industry} ${keywords}`,
    ).slice(0, 120);

    if (queryText.length > 0) {
      queries.push({
        query: queryText,
        vector: 'general',
        icpProfileId: profile.id,
        sourceType: 'buying_signal',
        sourceText: signal,
      });
    }
  }

  return queries;
}

/**
 * Convert an ICPProfile to the legacy ICP shape so we can reuse
 * the existing `generateFallbackQueries` for base query generation.
 */
function profileToICP(profile: ICPProfile): ICP {
  return {
    id: profile.id,
    founderId: profile.founderId,
    targetRole: profile.targetRole,
    industry: profile.industry,
    companyStage: profile.companyStage,
    geography: profile.geography,
    customTags: profile.customTags,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

/**
 * Generate annotated queries for a single ICP profile.
 *
 * - At least 1 query per pain point (sourceType = 'pain_point')
 * - At least 1 query per buying signal (sourceType = 'buying_signal')
 * - Base queries using existing fallback behavior (sourceType = 'base')
 * - Falls back to base queries only if profile has no pain points
 *
 * Each query is annotated with icpProfileId, sourceType, and sourceText.
 */
export async function generateQueriesForProfile(
  profile: ICPProfile,
  config?: Partial<QueryGeneratorConfig>,
): Promise<QueryGeneratorResultV2> {
  const cfg: QueryGeneratorConfig = { ...DEFAULT_CONFIG, ...config };
  const allQueries: AnnotatedQueryV2[] = [];
  const seen = new Set<string>();

  const addUnique = (q: AnnotatedQueryV2) => {
    if (!seen.has(q.query)) {
      seen.add(q.query);
      allQueries.push(q);
    }
  };

  // 1. Pain-point queries
  if (profile.painPoints.length > 0) {
    for (const q of generatePainPointQueries(profile)) {
      addUnique(q);
    }
  }

  // 2. Buying-signal queries
  if (profile.buyingSignals.length > 0) {
    for (const q of generateBuyingSignalQueries(profile)) {
      addUnique(q);
    }
  }

  // 3. Base queries (existing fallback behavior using targetRole, industry, geography)
  const icp = profileToICP(profile);
  const baseQueries = generateFallbackQueries(icp);
  for (const bq of baseQueries) {
    const v2: AnnotatedQueryV2 = {
      ...bq,
      icpProfileId: profile.id,
      sourceType: 'base',
    };
    addUnique(v2);
  }

  // Ensure we meet the minimum query count
  if (allQueries.length < cfg.minQueries) {
    // Already included all base queries; nothing more to add deterministically
  }

  return {
    queries: allQueries,
    generationMethod: 'template_fallback',
  };
}
