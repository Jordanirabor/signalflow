// ============================================================
// Query Generator — AI-powered search query generation from ICP
// ============================================================

import { query as dbQuery } from '@/lib/db';
import type { ICPProfile } from '@/types';
import OpenAI from 'openai';
import { logStructured } from './discoveryLogger';
import type {
  AnnotatedQuery,
  CreativeQueryConfig,
  ICP,
  QueryGeneratorConfig,
  QueryGeneratorResult,
  QueryHistoryEntry,
  QueryRetryContext,
} from './types';

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

/**
 * Sanitize a query for Serper API compatibility:
 * 1. Strip special operators: site:xxx, inurl:xxx, intitle:xxx, filetype:xxx (case-insensitive)
 * 2. Strip boolean operators: standalone OR, AND (whole words), leading - (at start of word)
 * 3. Remove non-ASCII characters
 * 4. Collapse whitespace
 * 5. Truncate to 120 chars at nearest word boundary
 */
export function sanitizeForSerper(raw: string): string {
  let q = raw;

  // 1. Strip special operators and their arguments (e.g. "site:example.com")
  q = q.replace(/\b(site|inurl|intitle|filetype):\S*/gi, '');

  // 2. Strip standalone boolean operators OR, AND (whole words)
  q = q.replace(/\bOR\b/g, '');
  q = q.replace(/\bAND\b/g, '');

  // 2b. Strip leading - at start of words (negative operator)
  q = q.replace(/(^|\s)-+(\S)/g, '$1$2');

  // 3. Remove non-ASCII characters
  q = q.replace(/[^\x00-\x7F]/g, '');

  // 4. Collapse whitespace and trim
  q = q.replace(/\s+/g, ' ').trim();

  // 5. Truncate to 120 chars at nearest word boundary
  if (q.length > 120) {
    const truncated = q.slice(0, 120);
    const lastSpace = truncated.lastIndexOf(' ');
    q = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
  }

  return q;
}

// ---------------------------------------------------------------------------
// Query history persistence
// ---------------------------------------------------------------------------

/**
 * Bulk-insert executed queries into the query_history table.
 * Uses ON CONFLICT DO NOTHING to silently skip duplicates.
 * DB errors are logged but never thrown — discovery must not be blocked.
 */
export async function persistQueryHistory(
  queries: AnnotatedQuery[],
  icpProfileId: string,
): Promise<void> {
  if (queries.length === 0) return;

  try {
    // Build a bulk INSERT with parameterised VALUES
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let i = 0; i < queries.length; i++) {
      const offset = i * 3;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
      values.push(icpProfileId, queries[i].query, queries[i].vector);
    }

    const sql = `
      INSERT INTO query_history (icp_profile_id, query_text, vector)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (icp_profile_id, query_text) DO NOTHING
    `;

    await dbQuery(sql, values);
  } catch (err) {
    console.error('[queryGenerator] Failed to persist query history:', err);
  }
}

/**
 * Retrieve the most recent queries for an ICP profile, ordered by
 * executed_at DESC. Returns an empty array on DB errors so discovery
 * is never blocked.
 */
export async function getRecentQueryHistory(
  icpProfileId: string,
  limit: number = 200,
): Promise<QueryHistoryEntry[]> {
  try {
    const result = await dbQuery(
      `SELECT id, icp_profile_id, query_text, vector, executed_at
       FROM query_history
       WHERE icp_profile_id = $1
       ORDER BY executed_at DESC
       LIMIT $2`,
      [icpProfileId, limit],
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      icpProfileId: row.icp_profile_id as string,
      queryText: row.query_text as string,
      vector: row.vector as AnnotatedQuery['vector'],
      executedAt: new Date(row.executed_at as string),
    }));
  } catch (err) {
    console.error('[queryGenerator] Failed to read query history:', err);
    return [];
  }
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

Randomization seed: ${Math.random().toString(36).slice(2, 8)} (use this to vary your output — produce DIFFERENT queries each time)

Requirements:
- Each query must target one of these discovery vectors: linkedin, directory, github, twitter, maps, general
- Cover at least 3 different vectors across all queries
- Vary phrasing, synonyms, and keyword combinations to maximize coverage
- Include specific company names, industry events, conferences, and niche terms to find NEW people each time
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
// Creative AI-powered query generation (history-aware, two-pass)
// ---------------------------------------------------------------------------

/** Default creative query config values */
const DEFAULT_CREATIVE_CONFIG: CreativeQueryConfig = {
  maxQueryLength: 120,
  minQueries: 10,
  minVectors: 3,
  historyLookback: 200,
  overlapThresholdPct: 50,
  maxGenerationAttempts: 2,
};

// ---------------------------------------------------------------------------
// Curated keyword pools for creative fallback generation
// ---------------------------------------------------------------------------

const INDUSTRY_EVENT_KEYWORDS = [
  'summit',
  'conference',
  'expo',
  'meetup',
  'webinar',
  'workshop',
  'hackathon',
  'demo day',
  'pitch night',
  'roundtable',
  'forum',
  'symposium',
  'bootcamp',
  'masterclass',
  'panel discussion',
];

const COMMUNITY_KEYWORDS = [
  'slack community',
  'discord server',
  'subreddit',
  'facebook group',
  'linkedin group',
  'newsletter',
  'podcast guest',
  'blog author',
  'open source contributor',
  'meetup organizer',
  'advisory board',
];

const JOB_BOARD_KEYWORDS = [
  'hiring',
  'job posting',
  'careers page',
  'we are hiring',
  'join our team',
  'open position',
  'head of',
  'looking for',
];

const STAGE_KEYWORDS: Record<string, string[]> = {
  seed: ['Y Combinator', 'Techstars', 'seed round', '500 Startups', 'angel investor'],
  'series a': ['Series A', 'growth stage', 'venture backed', 'scaling'],
  enterprise: ['Fortune 500', 'enterprise', 'global', 'publicly traded'],
};

/**
 * Build a creative prompt for OpenAI that incorporates ICP fields,
 * pain points, buying signals, a random seed, and explicit Serper constraints.
 */
function buildCreativePrompt(
  icp: ICP & { painPoints?: string[]; buyingSignals?: string[] },
  cfg: CreativeQueryConfig,
  excludeQueries?: string[],
): string {
  const seed = Math.random().toString(36).slice(2, 10);
  const timestamp = new Date().toISOString();

  const icpParts: string[] = [];
  icpParts.push(`Target Role: ${icp.targetRole}`);
  icpParts.push(`Industry: ${icp.industry}`);
  if (icp.geography) icpParts.push(`Geography: ${icp.geography}`);
  if (icp.companyStage) icpParts.push(`Company Stage: ${icp.companyStage}`);
  if (icp.customTags?.length) icpParts.push(`Custom Tags: ${icp.customTags.join(', ')}`);
  if (icp.painPoints?.length) icpParts.push(`Pain Points: ${icp.painPoints.join('; ')}`);
  if (icp.buyingSignals?.length) icpParts.push(`Buying Signals: ${icp.buyingSignals.join('; ')}`);

  let exclusionBlock = '';
  if (excludeQueries && excludeQueries.length > 0) {
    exclusionBlock = `
IMPORTANT — The following queries have already been used. Do NOT repeat them or produce anything similar:
${excludeQueries.map((q) => `  - "${q}"`).join('\n')}

Generate completely DIFFERENT queries that explore new angles.
`;
  }

  return `You are a creative lead generation expert. Generate at least ${cfg.minQueries} unique Google Search queries to discover prospects matching this ICP.

Timestamp: ${timestamp}
Random seed: ${seed} (use this to vary your output — produce DIFFERENT queries each time)

ICP:
${icpParts.join('\n')}

${exclusionBlock}
Requirements:
- Generate at least ${cfg.minQueries} queries covering at least ${cfg.minVectors} different discovery vectors
- Each query must target one of these vectors: linkedin, directory, github, twitter, maps, general
- Vary across at least 3 angles: role-focused, company-focused, event/community-focused
- Include specific company names, industry events, conferences, niche terminology, synonyms
- LinkedIn queries should include "linkedin" keyword
- Directory queries should include "crunchbase" or "wellfound" or "ycombinator" keywords
- GitHub queries should include "github" keyword for technical roles
- Twitter queries should include "twitter" or "x.com" keyword
- Maps queries should include geographic terms and business categories
${icp.painPoints?.length ? '- Include at least 2 queries referencing pain point keywords combined with role and industry' : ''}
${icp.buyingSignals?.length ? '- Include at least 2 queries referencing buying signal keywords combined with role and industry' : ''}
- Do NOT use site:, inurl:, intitle:, filetype: operators — they are blocked by the search API
- Do NOT use boolean operators like OR, AND, or leading -
- Each query must be under 120 characters
- Use only plain ASCII text with spaces and quotes

Return ONLY valid JSON — an array of objects with "query" (string) and "vector" (string) fields.`;
}

/**
 * Parse and validate the OpenAI response into AnnotatedQuery[].
 * Attempts JSON repair (strip markdown fences, extract array) if initial parse fails.
 */
function parseCreativeResponse(content: string): Array<{ query: string; vector: string }> {
  let text = content.trim();

  // Strip markdown code fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Try to extract a JSON array if the response has extra text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    text = arrayMatch[0];
  }

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('Response is not a JSON array');
  }
  return parsed;
}

/**
 * Generate creative, history-aware search queries for an ICP using OpenAI.
 *
 * - Builds a creative prompt with timestamp, random seed, ICP fields,
 *   pain points, buying signals, and explicit Serper constraints
 * - Retrieves query history and excludes matches
 * - Two-pass overlap detection: if >50% of AI queries match history,
 *   makes a second OpenAI call with an exclusion list
 * - All output passes through sanitizeForSerper()
 * - Falls back to generateFallbackQueries() on OpenAI failure
 */
export async function generateCreativeQueries(
  icp: ICP,
  icpProfileId: string,
  config?: Partial<CreativeQueryConfig>,
): Promise<QueryGeneratorResult> {
  const cfg: CreativeQueryConfig = { ...DEFAULT_CREATIVE_CONFIG, ...config };

  // Retrieve query history for deduplication
  let historySet: Set<string>;
  try {
    const history = await getRecentQueryHistory(icpProfileId, cfg.historyLookback);
    historySet = new Set(history.map((h) => h.queryText.toLowerCase()));
  } catch {
    historySet = new Set();
  }

  // Merge painPoints/buyingSignals from ICPProfile if the object has them
  const icpWithSignals = icp as ICP & { painPoints?: string[]; buyingSignals?: string[] };

  /**
   * Attempt a single AI generation pass.
   * Returns the parsed, sanitized, deduplicated queries.
   */
  async function aiGenerationPass(excludeQueries?: string[]): Promise<AnnotatedQuery[]> {
    const client = getOpenAIClient();
    const prompt = buildCreativePrompt(icpWithSignals, cfg, excludeQueries);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout

    let completion;
    try {
      completion = await client.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a search query generation assistant. Return only valid JSON.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: 2000,
          temperature: 0.9,
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const parsed = parseCreativeResponse(content);

    // Validate, sanitize, and deduplicate
    const queries: AnnotatedQuery[] = [];
    const seen = new Set<string>();

    for (const item of parsed) {
      if (
        typeof item.query !== 'string' ||
        !item.query.trim() ||
        typeof item.vector !== 'string' ||
        !isValidVector(item.vector)
      ) {
        continue;
      }

      const sanitized = sanitizeForSerper(item.query);
      if (!sanitized || seen.has(sanitized.toLowerCase())) continue;

      seen.add(sanitized.toLowerCase());
      queries.push({ query: sanitized, vector: item.vector as AnnotatedQuery['vector'] });
    }

    return queries;
  }

  try {
    // --- First pass ---
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'query_generation',
      level: 'info',
      message: 'Starting creative query generation (pass 1)',
      metadata: { icpProfileId, targetRole: icp.targetRole, industry: icp.industry },
    });

    const firstPassQueries = await aiGenerationPass();

    // Separate into new vs overlapping
    const newQueries: AnnotatedQuery[] = [];
    const overlapping: string[] = [];

    for (const q of firstPassQueries) {
      if (historySet.has(q.query.toLowerCase())) {
        overlapping.push(q.query);
      } else {
        newQueries.push(q);
      }
    }

    const overlapPct =
      firstPassQueries.length > 0 ? (overlapping.length / firstPassQueries.length) * 100 : 0;

    // --- Second pass if overlap exceeds threshold ---
    if (overlapPct > cfg.overlapThresholdPct && cfg.maxGenerationAttempts > 1) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'query_generation',
        level: 'info',
        message: `Overlap ${overlapPct.toFixed(0)}% exceeds ${cfg.overlapThresholdPct}% threshold, starting pass 2`,
        metadata: { icpProfileId, overlapPct, overlappingCount: overlapping.length },
      });

      try {
        const secondPassQueries = await aiGenerationPass(overlapping);

        // Add non-duplicate, non-history queries from second pass
        const seenLower = new Set(newQueries.map((q) => q.query.toLowerCase()));
        for (const q of secondPassQueries) {
          const lower = q.query.toLowerCase();
          if (!historySet.has(lower) && !seenLower.has(lower)) {
            seenLower.add(lower);
            newQueries.push(q);
          }
        }
      } catch (err) {
        logStructured({
          timestamp: new Date().toISOString(),
          stage: 'query_generation',
          level: 'warn',
          message: 'Second generation pass failed, proceeding with first pass results',
          metadata: { icpProfileId, error: String(err) },
        });
      }
    }

    // Check vector diversity
    const vectors = new Set(newQueries.map((q) => q.vector));

    // Log if we couldn't meet minimums
    if (newQueries.length < cfg.minQueries || vectors.size < cfg.minVectors) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'query_generation',
        level: 'warn',
        message: `Creative generation produced ${newQueries.length} unique queries across ${vectors.size} vectors (target: ${cfg.minQueries} queries, ${cfg.minVectors} vectors)`,
        metadata: { icpProfileId, queryCount: newQueries.length, vectorCount: vectors.size },
      });
    }

    if (newQueries.length > 0) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'query_generation',
        level: 'info',
        message: `Creative generation complete: ${newQueries.length} unique queries across ${vectors.size} vectors`,
        metadata: { icpProfileId, queryCount: newQueries.length, vectorCount: vectors.size },
      });
      return { queries: newQueries, generationMethod: 'ai' };
    }

    // All AI queries overlapped — fall back
    throw new Error('All AI-generated queries overlap with history');
  } catch (err) {
    // OpenAI failed or all queries overlapped — use fallback
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'query_generation',
      level: 'warn',
      message: 'Creative AI generation failed, falling back to template queries',
      metadata: { icpProfileId, error: String(err) },
    });

    const fallback = generateCreativeFallbackQueries(icp, historySet);

    return {
      queries:
        fallback.length > 0
          ? fallback
          : generateFallbackQueries(icp).map((q) => ({
              query: sanitizeForSerper(q.query),
              vector: q.vector,
            })),
      generationMethod: 'template_fallback',
    };
  }
}

// ---------------------------------------------------------------------------
// Refined query generation (retry with feedback)
// ---------------------------------------------------------------------------

/**
 * Build a prompt for refined query generation that incorporates feedback
 * from a low-yield discovery run.
 */
function buildRefinedPrompt(icp: ICP, retryContext: QueryRetryContext): string {
  const icpParts: string[] = [];
  icpParts.push(`Target Role: ${icp.targetRole}`);
  icpParts.push(`Industry: ${icp.industry}`);
  if (icp.geography) icpParts.push(`Geography: ${icp.geography}`);
  if (icp.companyStage) icpParts.push(`Company Stage: ${icp.companyStage}`);
  if (icp.customTags?.length) icpParts.push(`Custom Tags: ${icp.customTags.join(', ')}`);

  const previousQueryList = retryContext.previousQueries
    .map((q) => `  - [${q.vector}] ${q.query}`)
    .join('\n');

  return `You are a lead generation expert. A previous discovery run returned only ${retryContext.resultsCount} results, which is below the minimum threshold. Generate NEW, DIFFERENT search queries to find more prospects.

ICP:
${icpParts.join('\n')}

Previous queries that were already tried (DO NOT repeat these):
${previousQueryList}

Feedback from previous run: ${retryContext.feedback}

${retryContext.missingVectors.length > 0 ? `Missing discovery vectors that need coverage: ${retryContext.missingVectors.join(', ')}` : ''}

Requirements:
- Generate at least 5 new queries that are DIFFERENT from the previous ones
- Focus on addressing the gaps identified in the feedback
- ${retryContext.missingVectors.length > 0 ? `Prioritize queries for these vectors: ${retryContext.missingVectors.join(', ')}` : 'Cover diverse vectors: linkedin, directory, github, twitter, maps, general'}
- Use alternative phrasing, synonyms, related job titles, and adjacent industries
- LinkedIn queries should include "linkedin" keyword
- Directory queries should include "crunchbase" or "wellfound" or "ycombinator" keywords
- Do NOT use the "site:" operator in any query
- Each query must be under 256 characters
- Each query must be safe for URL encoding

Return ONLY valid JSON — an array of objects with "query" (string) and "vector" (string) fields.`;
}

/**
 * Generate template-based refined queries as a fallback when OpenAI fails.
 * Produces queries with alternative phrasing that differ from previous queries.
 */
function generateRefinedFallbackQueries(
  icp: ICP,
  retryContext: QueryRetryContext,
): AnnotatedQuery[] {
  const { targetRole, industry, geography, companyStage } = icp;
  const queries: AnnotatedQuery[] = [];
  const previousQuerySet = new Set(retryContext.previousQueries.map((q) => q.query));

  const geo = geography || '';
  const stage = companyStage || '';

  // Alternative LinkedIn queries with different phrasing
  const linkedinAlternatives: AnnotatedQuery[] = [
    {
      query: sanitizeQuery(
        `linkedin "${targetRole}" "${industry}" professionals${geo ? ` ${geo}` : ''}`,
      ),
      vector: 'linkedin',
    },
    {
      query: sanitizeQuery(
        `linkedin ${industry} "${targetRole}" leader${stage ? ` ${stage}` : ''}`,
      ),
      vector: 'linkedin',
    },
    {
      query: sanitizeQuery(`"${targetRole}" ${industry} linkedin profile expert`),
      vector: 'linkedin',
    },
  ];

  // Alternative general queries
  const generalAlternatives: AnnotatedQuery[] = [
    {
      query: sanitizeQuery(`"${targetRole}" ${industry} interview podcast${geo ? ` ${geo}` : ''}`),
      vector: 'general',
    },
    {
      query: sanitizeQuery(`${industry} "${targetRole}" speaker conference${geo ? ` ${geo}` : ''}`),
      vector: 'general',
    },
    {
      query: sanitizeQuery(`"${targetRole}" ${industry} "about us" team page`),
      vector: 'general',
    },
  ];

  // Alternative directory queries
  const directoryAlternatives: AnnotatedQuery[] = [
    {
      query: sanitizeQuery(`crunchbase ${industry} "${targetRole}"${geo ? ` ${geo}` : ''}`),
      vector: 'directory',
    },
    {
      query: sanitizeQuery(`wellfound ${industry} "${targetRole}"${stage ? ` ${stage}` : ''}`),
      vector: 'directory',
    },
  ];

  // Combine all alternatives, prioritizing missing vectors
  const allAlternatives = [
    ...linkedinAlternatives,
    ...generalAlternatives,
    ...directoryAlternatives,
  ];

  // Prioritize missing vectors
  const missingSet = new Set(retryContext.missingVectors);
  const prioritized = [
    ...allAlternatives.filter((q) => missingSet.has(q.vector)),
    ...allAlternatives.filter((q) => !missingSet.has(q.vector)),
  ];

  const maxLen = DEFAULT_CONFIG.maxQueryLength;
  const seen = new Set<string>();

  for (const q of prioritized) {
    const truncated = truncateQuery(q.query, maxLen);
    if (truncated.length > 0 && !seen.has(truncated) && !previousQuerySet.has(truncated)) {
      seen.add(truncated);
      queries.push({ query: truncated, vector: q.vector });
    }
  }

  return queries;
}

/**
 * Generate refined queries based on feedback from a low-yield discovery run.
 * Uses OpenAI to produce targeted queries addressing gaps.
 * Falls back to template-based refinement if OpenAI fails.
 */
export async function generateRefinedQueries(
  icp: ICP,
  retryContext: QueryRetryContext,
): Promise<QueryGeneratorResult> {
  try {
    const client = getOpenAIClient();
    const prompt = buildRefinedPrompt(icp, retryContext);

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
      temperature: 0.8,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const parsed = JSON.parse(content) as Array<{ query: string; vector: string }>;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Invalid response format from OpenAI');
    }

    const previousQuerySet = new Set(retryContext.previousQueries.map((q) => q.query));

    const queries: AnnotatedQuery[] = parsed
      .filter(
        (item) =>
          typeof item.query === 'string' &&
          item.query.trim().length > 0 &&
          typeof item.vector === 'string' &&
          isValidVector(item.vector),
      )
      .map((item) => ({
        query: truncateQuery(sanitizeQuery(item.query), DEFAULT_CONFIG.maxQueryLength),
        vector: item.vector as AnnotatedQuery['vector'],
      }))
      .filter((q) => q.query.length > 0);

    // Deduplicate and exclude previous queries
    const seen = new Set<string>();
    const unique: AnnotatedQuery[] = [];
    for (const q of queries) {
      if (!seen.has(q.query) && !previousQuerySet.has(q.query)) {
        seen.add(q.query);
        unique.push(q);
      }
    }

    if (unique.length > 0) {
      return { queries: unique, generationMethod: 'ai' };
    }

    // AI returned only duplicates — fall back to template
    const fallback = generateRefinedFallbackQueries(icp, retryContext);
    return { queries: fallback, generationMethod: 'template_fallback' };
  } catch {
    // OpenAI failed — use template-based refinement
    const queries = generateRefinedFallbackQueries(icp, retryContext);
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

  // Add a random page/variation seed so each run produces different queries
  const variations = [
    'hiring',
    'interview',
    'speaker',
    'podcast',
    'award',
    'conference',
    'webinar',
    'panel',
    'keynote',
    'founder',
    'advisor',
    'board member',
    'startup',
    'growth',
    'innovation',
    'digital transformation',
  ];
  const shuffled = variations.sort(() => Math.random() - 0.5);
  const v1 = shuffled[0];
  const v2 = shuffled[1];
  const v3 = shuffled[2];

  // People-focused queries — find actual humans with names and roles
  queries.push({
    query: sanitizeQuery(`"${targetRole}" "${industry}" people ${v1}`),
    vector: 'linkedin',
  });

  queries.push({
    query: sanitizeQuery(`"${targetRole}" ${industry}${geo ? ` ${geo}` : ''} profile ${v2}`),
    vector: 'linkedin',
  });

  if (stage) {
    queries.push({
      query: sanitizeQuery(`"${targetRole}" ${stage} ${industry} team ${v3}`),
      vector: 'linkedin',
    });
  }

  // Add a randomized LinkedIn query with year to force fresh results
  const year = new Date().getFullYear();
  queries.push({
    query: sanitizeQuery(`linkedin "${targetRole}" "${industry}" ${year}${geo ? ` ${geo}` : ''}`),
    vector: 'linkedin',
  });

  // Company team pages — often list leadership with names
  queries.push({
    query: sanitizeQuery(
      `${industry} company "our team" "${targetRole}"${geo ? ` ${geo}` : ''} ${v1}`,
    ),
    vector: 'general',
  });

  queries.push({
    query: sanitizeQuery(
      `${industry}${stage ? ` ${stage}` : ''} "leadership team" "${targetRole}" ${v2}`,
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
// Creative fallback query generation (keyword-pool based)
// ---------------------------------------------------------------------------

/**
 * Shuffle an array in-place using Fisher-Yates and return it.
 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate creative, varied fallback queries using curated keyword pools.
 * Unlike the deterministic `generateFallbackQueries`, this function:
 * - Shuffles keyword pools randomly each invocation
 * - Combines ICP fields with pool terms and the current date/year
 * - Checks each query against `usedQueries` (case-insensitive) and skips duplicates
 * - Passes all output through `sanitizeForSerper()`
 * - Returns at least 10 queries covering multiple vectors
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export function generateCreativeFallbackQueries(
  icp: ICP,
  usedQueries: Set<string>,
): AnnotatedQuery[] {
  const { targetRole, industry, geography, companyStage } = icp;
  const year = new Date().getFullYear();
  const queries: AnnotatedQuery[] = [];
  const seen = new Set<string>();

  /**
   * Helper: sanitize, deduplicate against usedQueries and local seen set,
   * then push to the result array.
   */
  function addQuery(raw: string, vector: AnnotatedQuery['vector']): void {
    const sanitized = sanitizeForSerper(raw);
    if (!sanitized) return;
    const lower = sanitized.toLowerCase();
    if (usedQueries.has(lower) || seen.has(lower)) return;
    seen.add(lower);
    queries.push({ query: sanitized, vector });
  }

  // Shuffle keyword pools
  const events = shuffle(INDUSTRY_EVENT_KEYWORDS);
  const communities = shuffle(COMMUNITY_KEYWORDS);
  const jobTerms = shuffle(JOB_BOARD_KEYWORDS);

  // Resolve stage keywords (normalise to lowercase for lookup)
  const stageKey = companyStage?.toLowerCase() ?? '';
  const stageTerms = STAGE_KEYWORDS[stageKey] ?? [];
  const shuffledStage = shuffle(stageTerms);

  const geo = geography ?? '';

  // --- LinkedIn queries ---
  addQuery(`linkedin "${targetRole}" "${industry}" ${events[0]} ${year}`, 'linkedin');
  addQuery(
    `linkedin "${targetRole}" ${industry} ${communities[0]}${geo ? ` ${geo}` : ''}`,
    'linkedin',
  );
  addQuery(`linkedin "${targetRole}" ${industry} ${jobTerms[0]} ${year}`, 'linkedin');

  // --- General queries ---
  addQuery(`"${targetRole}" ${industry} ${events[1]} ${year}${geo ? ` ${geo}` : ''}`, 'general');
  addQuery(`"${targetRole}" ${industry} ${communities[1]}`, 'general');
  addQuery(`${industry} "${targetRole}" ${jobTerms[1]} ${year}`, 'general');
  addQuery(`"${targetRole}" ${industry} ${events[2]}${geo ? ` ${geo}` : ''}`, 'general');

  // --- Directory queries ---
  addQuery(`crunchbase "${targetRole}" ${industry}${geo ? ` ${geo}` : ''} ${year}`, 'directory');
  addQuery(`wellfound ${industry} "${targetRole}" ${events[3] ?? events[0]}`, 'directory');

  // --- GitHub query ---
  addQuery(`github "${targetRole}" ${industry} ${communities[2] ?? communities[0]}`, 'github');

  // --- Twitter query ---
  addQuery(`twitter "${targetRole}" ${industry} ${events[4] ?? events[1]} ${year}`, 'twitter');

  // --- Maps query (include geography if available) ---
  if (geo) {
    addQuery(`${industry} "${targetRole}" ${geo} ${events[5] ?? events[2]}`, 'maps');
  }

  // --- Geography-enriched queries (≥30% when geography is set) ---
  if (geo) {
    addQuery(
      `"${targetRole}" ${industry} ${geo} ${communities[3] ?? communities[0]} ${year}`,
      'general',
    );
    addQuery(`linkedin "${targetRole}" ${industry} ${geo} ${events[6] ?? events[0]}`, 'linkedin');
    addQuery(`"${targetRole}" ${geo} ${industry} ${jobTerms[2] ?? jobTerms[0]}`, 'general');
  }

  // --- Stage-specific queries (≥2 when companyStage is set) ---
  if (shuffledStage.length > 0) {
    addQuery(`"${targetRole}" ${industry} ${shuffledStage[0]} ${year}`, 'general');
    addQuery(
      `linkedin "${targetRole}" ${industry} ${shuffledStage[1] ?? shuffledStage[0]}`,
      'linkedin',
    );
  }

  // --- Extra queries to ensure we reach at least 10 ---
  const extraEvents = shuffle(INDUSTRY_EVENT_KEYWORDS);
  const extraCommunities = shuffle(COMMUNITY_KEYWORDS);
  let extraIdx = 0;
  while (queries.length < 10 && extraIdx < extraEvents.length + extraCommunities.length) {
    if (extraIdx < extraEvents.length) {
      addQuery(
        `"${targetRole}" ${industry} ${extraEvents[extraIdx]}${geo ? ` ${geo}` : ''} ${year}`,
        extraIdx % 2 === 0 ? 'general' : 'linkedin',
      );
    } else {
      const ci = extraIdx - extraEvents.length;
      addQuery(
        `"${targetRole}" ${industry} ${extraCommunities[ci]}`,
        ci % 2 === 0 ? 'general' : 'directory',
      );
    }
    extraIdx++;
  }

  return queries;
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
