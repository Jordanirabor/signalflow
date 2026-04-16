// ============================================================
// Enrichment Pipeline — Orchestrates multi-source prospect enrichment
// ============================================================

import type {
  ExtendedEnrichmentData,
  FieldCorroboration,
  ProspectContext,
  RunCache,
  SourceAdapter,
} from './types';

import { scoreConfidence } from './confidenceScorer';
import { discoverEmail } from './emailDiscovery';
import { isSourceAvailable, recordFailure, recordSuccess } from './healthMonitor';

// Enrichment source adapters
import { companyWebsiteScraper } from './companyWebsiteScraper';
import { githubScraper } from './githubScraper';
import { linkedinScraper } from './linkedinScraper';
import { newsScraper } from './newsScraper';
import { clearbitAdapter, hunterAdapter } from './premiumAdapters';
import { twitterScraper } from './twitterScraper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-prospect enrichment timeout in milliseconds (90 seconds) */
const ENRICHMENT_TIMEOUT_MS = 90_000;

/** Source priority tiers — higher number = higher priority */
const SOURCE_PRIORITY: Record<string, number> = {
  // Premium APIs (highest)
  clearbit_api: 100,
  hunter_api: 100,
  // Multi-source corroborated scrapers
  linkedin_scrape: 50,
  company_website_scrape: 50,
  // Single-source scrapers
  github_scrape: 30,
  twitter_scrape: 30,
  news_scrape: 10,
};

// ---------------------------------------------------------------------------
// All enrichment-capable adapters
// ---------------------------------------------------------------------------

const ALL_ENRICHMENT_ADAPTERS: SourceAdapter[] = [
  linkedinScraper,
  companyWebsiteScraper,
  newsScraper,
  twitterScraper,
  githubScraper,
  hunterAdapter,
  clearbitAdapter,
];

// ---------------------------------------------------------------------------
// Enrichment Status
// ---------------------------------------------------------------------------

/**
 * Determine enrichment status based on success/failure counts.
 * - "complete": all sources succeeded (failCount === 0)
 * - "partial": some succeeded, some failed
 * - "pending": all sources failed (successCount === 0)
 */
export function determineEnrichmentStatus(
  successCount: number,
  failCount: number,
): 'complete' | 'partial' | 'pending' {
  if (successCount === 0) return 'pending';
  if (failCount === 0) return 'complete';
  return 'partial';
}

// ---------------------------------------------------------------------------
// Merge Logic
// ---------------------------------------------------------------------------

/** Scalar fields on ExtendedEnrichmentData that should use priority-based merge */
const SCALAR_FIELDS: (keyof ExtendedEnrichmentData)[] = [
  'linkedinBio',
  'companyInfo',
  'email',
  'linkedinUrl',
  'companyDomain',
];

/** Array fields that should be concatenated and deduplicated */
const ARRAY_FIELDS: (keyof ExtendedEnrichmentData)[] = ['recentPosts', 'dataSources'];

/**
 * Get the priority of a source adapter. Higher = preferred.
 * Unknown sources default to priority 1.
 */
function getSourcePriority(sourceName: string): number {
  return SOURCE_PRIORITY[sourceName] ?? 1;
}

interface TaggedResult {
  sourceName: string;
  data: Partial<ExtendedEnrichmentData>;
}

/**
 * Check if a partial enrichment result has any meaningful data.
 */
function hasData(data: Partial<ExtendedEnrichmentData>): boolean {
  for (const key of Object.keys(data)) {
    const value = data[key as keyof ExtendedEnrichmentData];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return true;
  }
  return false;
}

/**
 * Merge enrichment results from multiple sources into a single ExtendedEnrichmentData.
 *
 * Rules:
 * - Scalar fields: prefer non-empty over empty; when conflicting, prefer highest-priority source
 * - Array fields (recentPosts, dataSources): concatenate and deduplicate
 * - Boolean/number fields: prefer from highest-priority source that provides them
 */
export function mergeEnrichmentResults(results: TaggedResult[]): ExtendedEnrichmentData {
  const merged: ExtendedEnrichmentData = {};

  // Sort results by source priority (highest first) so we process premium first
  const sorted = [...results].sort(
    (a, b) => getSourcePriority(b.sourceName) - getSourcePriority(a.sourceName),
  );

  // Track which source set each scalar field (for priority-based conflict resolution)
  const scalarSourcePriority: Record<string, number> = {};

  for (const { sourceName, data } of sorted) {
    const priority = getSourcePriority(sourceName);

    // Handle scalar fields
    for (const field of SCALAR_FIELDS) {
      const incoming = data[field] as string | undefined;
      if (!incoming || incoming.trim() === '') continue;

      const current = merged[field] as string | undefined;
      if (!current || current.trim() === '') {
        // No existing value — take the incoming one
        (merged as Record<string, unknown>)[field] = incoming;
        scalarSourcePriority[field] = priority;
      } else if (priority > (scalarSourcePriority[field] ?? 0)) {
        // Conflict: incoming has higher priority
        (merged as Record<string, unknown>)[field] = incoming;
        scalarSourcePriority[field] = priority;
      }
      // Otherwise keep existing (same or higher priority)
    }

    // Handle array fields — concatenate
    for (const field of ARRAY_FIELDS) {
      const incoming = data[field] as string[] | undefined;
      if (!incoming || incoming.length === 0) continue;

      const current = (merged as Record<string, unknown>)[field] as string[] | undefined;
      if (!current) {
        (merged as Record<string, unknown>)[field] = [...incoming];
      } else {
        // Concatenate and deduplicate
        const combined = [...current, ...incoming];
        (merged as Record<string, unknown>)[field] = [...new Set(combined)];
      }
    }

    // Handle boolean fields (emailVerified)
    if (data.emailVerified !== undefined && merged.emailVerified === undefined) {
      merged.emailVerified = data.emailVerified;
    }

    // Handle emailVerificationMethod
    if (data.emailVerificationMethod && !merged.emailVerificationMethod) {
      merged.emailVerificationMethod = data.emailVerificationMethod;
    }

    // Handle dataConfidenceScore — take highest
    if (
      data.dataConfidenceScore !== undefined &&
      (merged.dataConfidenceScore === undefined ||
        data.dataConfidenceScore > merged.dataConfidenceScore)
    ) {
      merged.dataConfidenceScore = data.dataConfidenceScore;
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Corroboration Builder
// ---------------------------------------------------------------------------

/**
 * Build field corroboration data from tagged results for confidence scoring.
 */
function buildCorroborations(results: TaggedResult[]): FieldCorroboration[] {
  const fieldMap = new Map<string, { sources: Set<string>; value: string }>();

  for (const { sourceName, data } of results) {
    for (const field of SCALAR_FIELDS) {
      const value = data[field] as string | undefined;
      if (!value || value.trim() === '') continue;

      const existing = fieldMap.get(field);
      if (existing) {
        existing.sources.add(sourceName);
      } else {
        fieldMap.set(field, { sources: new Set([sourceName]), value });
      }
    }
  }

  const corroborations: FieldCorroboration[] = [];
  for (const [field, { sources, value }] of fieldMap) {
    corroborations.push({
      field,
      sources: [...sources],
      value,
    });
  }

  return corroborations;
}

// ---------------------------------------------------------------------------
// Timeout Helper
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout. Returns the promise result or rejects on timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[EnrichmentPipeline] Timeout after ${ms}ms for ${label}`));
    }, ms);

    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Main Enrichment Function
// ---------------------------------------------------------------------------

/**
 * Enrich a single prospect by executing all enabled enrichment adapters concurrently,
 * merging results, discovering email, scoring confidence, and determining status.
 *
 * Returns enrichmentData and enrichmentStatus.
 */
export async function enrichProspect(
  prospect: ProspectContext,
  cache: RunCache,
): Promise<{
  enrichmentData: ExtendedEnrichmentData;
  enrichmentStatus: 'complete' | 'partial' | 'pending';
}> {
  // 1. Filter to enabled + healthy adapters
  const enabledAdapters = ALL_ENRICHMENT_ADAPTERS.filter(
    (adapter) => adapter.isEnabled() && isSourceAvailable(adapter.name),
  );

  if (enabledAdapters.length === 0) {
    console.error(
      '[EnrichmentPipeline] All enrichment sources are disabled or unavailable. Returning empty result.',
    );
    return {
      enrichmentData: {
        failedSources: ALL_ENRICHMENT_ADAPTERS.map((a) => a.name),
        dataSources: [],
        lastVerifiedAt: new Date(),
      },
      enrichmentStatus: 'pending',
    };
  }

  // 2. Execute all adapters concurrently with per-prospect timeout
  const adapterPromises = enabledAdapters.map((adapter) => {
    const enrichFn = async (): Promise<TaggedResult> => {
      if (!adapter.enrich) {
        return { sourceName: adapter.name, data: {} };
      }
      const data = await adapter.enrich(prospect);
      return { sourceName: adapter.name, data };
    };

    return withTimeout(enrichFn(), ENRICHMENT_TIMEOUT_MS, adapter.name);
  });

  const settled = await Promise.allSettled(adapterPromises);

  // 3. Separate successes and failures
  const successfulResults: TaggedResult[] = [];
  const dataSources: string[] = [];
  const failedSources: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const adapter = enabledAdapters[i];

    if (result.status === 'fulfilled') {
      const tagged = result.value;
      if (hasData(tagged.data)) {
        successfulResults.push(tagged);
        dataSources.push(adapter.name);
        recordSuccess(adapter.name);
      } else {
        // Returned empty — treat as failed for status tracking
        failedSources.push(adapter.name);
        console.log(
          `[EnrichmentPipeline] Source "${adapter.name}" returned empty data for "${prospect.name}".`,
        );
      }
    } else {
      failedSources.push(adapter.name);
      recordFailure(adapter.name);
      console.error(
        `[EnrichmentPipeline] Source "${adapter.name}" failed for "${prospect.name}":`,
        result.reason instanceof Error ? result.reason.message : String(result.reason),
      );
    }
  }

  // 4. Merge results from all successful adapters
  const merged = mergeEnrichmentResults(successfulResults);

  // 5. Email discovery
  try {
    const emailResult = await discoverEmail(prospect, cache);
    if (emailResult.email) {
      // Only override if we don't already have a verified email from a premium source
      if (!merged.email || !merged.emailVerified) {
        merged.email = emailResult.email;
        merged.emailVerified = emailResult.verified;
        merged.emailVerificationMethod = emailResult.verificationMethod;
      }
      merged.companyDomain = emailResult.companyDomain ?? merged.companyDomain;
    }
  } catch (error) {
    console.error(
      '[EnrichmentPipeline] Email discovery failed:',
      error instanceof Error ? error.message : String(error),
    );
  }

  // 6. Confidence scoring
  const corroborations = buildCorroborations(successfulResults);
  merged.dataConfidenceScore = scoreConfidence(corroborations);

  // 7. Record metadata
  merged.dataSources = [...new Set([...(merged.dataSources ?? []), ...dataSources])];
  merged.failedSources = failedSources;
  merged.lastVerifiedAt = new Date();

  // 8. Determine enrichment status
  const enrichmentStatus = determineEnrichmentStatus(
    successfulResults.length,
    failedSources.length,
  );

  console.log(
    `[EnrichmentPipeline] Enrichment for "${prospect.name}" complete. ` +
      `Status: ${enrichmentStatus}, Sources: ${dataSources.length} succeeded, ${failedSources.length} failed.`,
  );

  return { enrichmentData: merged, enrichmentStatus };
}
