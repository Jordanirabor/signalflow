// ============================================================
// Enrichment Pipeline — Orchestrates multi-source prospect enrichment
// ============================================================

import type {
  ExtendedEnrichmentData,
  FieldCorroboration,
  ProspectContext,
  ResearchAgentCompanyResult,
  ResearchAgentEmailResult,
  RunCache,
  SourceAdapter,
  WaterfallStep,
} from './types';

import { lookupCompanyForProspect, searchEmailForProspect } from '../prospectResearcherService';
import { scoreConfidence } from './confidenceScorer';
import { logEnrichmentSummary } from './discoveryLogger';
import { isSourceAvailable, recordFailure, recordSuccess } from './healthMonitor';
import { waterfallEmailDiscover } from './waterfallEmailFinder';

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
// Merge Enrichment With Existing (for retry merging)
// ---------------------------------------------------------------------------

/** All string fields on ExtendedEnrichmentData for merge purposes */
const ALL_STRING_FIELDS: (keyof ExtendedEnrichmentData)[] = [
  'linkedinBio',
  'companyInfo',
  'email',
  'linkedinUrl',
  'companyDomain',
  'emailVerificationMethod',
];

/** All array fields on ExtendedEnrichmentData for merge purposes */
const ALL_ARRAY_FIELDS: (keyof ExtendedEnrichmentData)[] = [
  'recentPosts',
  'dataSources',
  'failedSources',
];

/**
 * Helper to check if a value is considered "non-empty" for merge purposes.
 */
function isNonEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Merge new enrichment data with existing partial data using priority-based logic.
 *
 * Rules:
 * - New data overrides existing data only when the new value is non-empty/non-null
 * - Existing non-empty values are always preserved if new data provides empty/null
 * - For arrays (recentPosts, dataSources, failedSources): merge and deduplicate
 * - For dataConfidenceScore: take the higher value
 * - For emailVerified: new value overrides when defined
 * - For lastVerifiedAt: take the more recent date
 * - No previously populated field becomes empty after merge
 */
export function mergeEnrichmentWithExisting(
  existing: Partial<ExtendedEnrichmentData>,
  newData: Partial<ExtendedEnrichmentData>,
): Partial<ExtendedEnrichmentData> {
  const merged: Partial<ExtendedEnrichmentData> = { ...existing };

  // Handle string fields: new overrides existing only when new is non-empty
  for (const field of ALL_STRING_FIELDS) {
    const newValue = newData[field] as string | undefined;
    if (isNonEmpty(newValue)) {
      (merged as Record<string, unknown>)[field] = newValue;
    }
    // If new value is empty/null, existing value is preserved (already spread)
  }

  // Handle array fields: merge and deduplicate
  for (const field of ALL_ARRAY_FIELDS) {
    const existingArr = existing[field] as string[] | undefined;
    const newArr = newData[field] as string[] | undefined;

    if (isNonEmpty(newArr) && isNonEmpty(existingArr)) {
      // Both have values — combine and deduplicate
      (merged as Record<string, unknown>)[field] = [
        ...new Set([...(existingArr as string[]), ...(newArr as string[])]),
      ];
    } else if (isNonEmpty(newArr)) {
      // Only new has values
      (merged as Record<string, unknown>)[field] = [...(newArr as string[])];
    }
    // If only existing has values, it's already preserved from the spread
  }

  // Handle emailVerified: new overrides when defined
  if (newData.emailVerified !== undefined && newData.emailVerified !== null) {
    merged.emailVerified = newData.emailVerified;
  }

  // Handle dataConfidenceScore: take the higher value
  if (isNonEmpty(newData.dataConfidenceScore)) {
    if (
      !isNonEmpty(existing.dataConfidenceScore) ||
      newData.dataConfidenceScore! > existing.dataConfidenceScore!
    ) {
      merged.dataConfidenceScore = newData.dataConfidenceScore;
    }
  }

  // Handle lastVerifiedAt: take the more recent date
  if (isNonEmpty(newData.lastVerifiedAt)) {
    if (!isNonEmpty(existing.lastVerifiedAt)) {
      merged.lastVerifiedAt = newData.lastVerifiedAt;
    } else {
      const existingDate =
        existing.lastVerifiedAt instanceof Date
          ? existing.lastVerifiedAt
          : new Date(existing.lastVerifiedAt as unknown as string);
      const newDate =
        newData.lastVerifiedAt instanceof Date
          ? newData.lastVerifiedAt
          : new Date(newData.lastVerifiedAt as unknown as string);
      const existingTime = existingDate.getTime();
      const newTime = newDate.getTime();
      merged.lastVerifiedAt = newTime > existingTime ? newDate : existingDate;
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
// Research Agent Fallback — Company Resolution
// ---------------------------------------------------------------------------

/**
 * Use the research agent to find a prospect's company name
 * when it's missing from the ProspectContext.
 */
async function resolveCompanyViaResearchAgent(
  prospect: ProspectContext,
): Promise<ResearchAgentCompanyResult> {
  try {
    const result = await lookupCompanyForProspect(prospect.name, {
      role: prospect.role,
      linkedinUrl: prospect.linkedinUrl,
      twitterHandle: prospect.twitterHandle,
    });

    if (result.company) {
      console.log(
        `[EnrichmentPipeline] Research agent resolved company for "${prospect.name}": "${result.company}" (source: ${result.source})`,
      );
      return {
        company: result.company,
        source: result.source === 'content_extraction' ? 'content_extraction' : 'web_search',
        confidence: result.source === 'content_extraction' ? 'high' : 'medium',
      };
    }

    console.log(
      `[EnrichmentPipeline] Research agent could not resolve company for "${prospect.name}" (source: ${result.source})`,
    );
    return { company: null, source: 'web_search', confidence: 'low' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[EnrichmentPipeline] Research agent company lookup failed for "${prospect.name}": ${message}`,
    );
    return { company: null, source: 'web_search', confidence: 'low' };
  }
}

// ---------------------------------------------------------------------------
// Research Agent Fallback — Direct Email Discovery
// ---------------------------------------------------------------------------

/**
 * Use the research agent to search for a prospect's email
 * directly via web search when the waterfall fails.
 */
async function discoverEmailViaResearchAgent(
  prospect: ProspectContext,
  cache: RunCache,
): Promise<ResearchAgentEmailResult> {
  try {
    const result = await searchEmailForProspect(prospect.name, prospect.company);

    if (result.email) {
      console.log(
        `[EnrichmentPipeline] Research agent found email for "${prospect.name}": "${result.email}" (source: ${result.source})`,
      );
      // Check MX records from cache if available
      const domain = result.email.split('@')[1];
      const hasMX = domain ? (cache.getMXRecords(domain) ?? []).length > 0 : false;
      return {
        email: result.email,
        hasMXRecords: hasMX,
        source: 'research_agent_web_search',
        confidence: 'medium',
      };
    }

    console.log(
      `[EnrichmentPipeline] Research agent could not find email for "${prospect.name}" (source: ${result.source})`,
    );
    return {
      email: null,
      hasMXRecords: false,
      source: 'research_agent_web_search',
      confidence: 'medium',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[EnrichmentPipeline] Research agent email search failed for "${prospect.name}": ${message}`,
    );
    return {
      email: null,
      hasMXRecords: false,
      source: 'research_agent_web_search',
      confidence: 'medium',
    };
  }
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
  emailDiscoveryMethod: string | null;
  emailDiscoverySteps: WaterfallStep[];
  companyResolvedVia?: string;
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
      emailDiscoveryMethod: null,
      emailDiscoverySteps: [],
      companyResolvedVia: undefined,
    };
  }

  // 2. Track all attempted adapter names for logging
  const sourcesAttempted = enabledAdapters.map((a) => a.name);

  // 3. Execute all adapters concurrently with per-prospect timeout
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

  // 4. Separate successes and failures
  const successfulResults: TaggedResult[] = [];
  const dataSources: string[] = [];
  const failedSources: string[] = [];
  const sourcesFailedReasons: Record<string, string> = {};

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
        sourcesFailedReasons[adapter.name] = 'returned empty data';
        console.log(
          `[EnrichmentPipeline] Source "${adapter.name}" returned empty data for "${prospect.name}".`,
        );
      }
    } else {
      failedSources.push(adapter.name);
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      sourcesFailedReasons[adapter.name] = reason;
      recordFailure(adapter.name);
      console.error(
        `[EnrichmentPipeline] Source "${adapter.name}" failed for "${prospect.name}":`,
        reason,
      );
    }
  }

  // 4. Merge results from all successful adapters
  const merged = mergeEnrichmentResults(successfulResults);

  // 5. Email discovery — research agent first, waterfall as fallback
  let emailResultStr = 'none';
  let emailDiscoveryMethod: string | null = null;
  let emailDiscoverySteps: WaterfallStep[] = [];
  let companyResolvedVia: string | undefined;

  // 5a. If no company, try research agent to resolve it first
  if (!prospect.company) {
    const companyResult = await resolveCompanyViaResearchAgent(prospect);
    if (companyResult.company) {
      prospect.company = companyResult.company;
      companyResolvedVia = 'research_agent';
      emailDiscoverySteps.push({
        method: 'research_agent_company',
        result: 'found',
        duration_ms: 0,
      });
    } else {
      console.log(
        `[EnrichmentPipeline] Research agent could not resolve company for "${prospect.name}", enrichment_status will be partial`,
      );
      emailDiscoverySteps.push({
        method: 'research_agent_company',
        result: 'not_found',
        duration_ms: 0,
      });
    }
  }

  // 5b. Research agent direct email search (tries to find real publicly listed emails)
  const emailAgentResult = await discoverEmailViaResearchAgent(prospect, cache);
  if (emailAgentResult.email) {
    merged.email = emailAgentResult.email;
    merged.emailVerified = false;
    merged.emailVerificationMethod = 'research_agent_web_search';
    emailResultStr = emailAgentResult.email;
    emailDiscoveryMethod = 'research_agent_web_search';
    emailDiscoverySteps.push({
      method: 'research_agent_email',
      result: 'found',
      email: emailAgentResult.email,
      duration_ms: 0,
    });
    console.log(
      `[EnrichmentPipeline] Research agent found email for "${prospect.name}": "${emailAgentResult.email}"`,
    );
  } else {
    emailDiscoverySteps.push({
      method: 'research_agent_email',
      result: 'not_found',
      duration_ms: 0,
    });

    // 5c. Waterfall email discovery as fallback (pattern inference, Hunter, Apollo, SMTP)
    try {
      const emailResult = await waterfallEmailDiscover(prospect, cache);

      console.log(
        `[EnrichmentPipeline] Waterfall email discovery for "${prospect.name}": ` +
          `method=${emailResult.finalMethod ?? 'none'}, verified=${emailResult.verified}, ` +
          `confidence=${emailResult.confidence}, steps=${emailResult.stepsAttempted.length} ` +
          `(${emailResult.stepsAttempted.map((s) => `${s.method}:${s.result}`).join(', ')})`,
      );

      emailDiscoverySteps.push(...emailResult.stepsAttempted);

      if (emailResult.email) {
        emailResultStr = emailResult.email;
        emailDiscoveryMethod = emailResult.finalMethod;
        if (!merged.email || !merged.emailVerified) {
          merged.email = emailResult.email;
          merged.emailVerified = emailResult.verified;
          merged.emailVerificationMethod = emailResult.verificationMethod;
        }
        merged.companyDomain = emailResult.companyDomain ?? merged.companyDomain;
      }
    } catch (error) {
      console.error(
        '[EnrichmentPipeline] Waterfall email discovery failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
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

  // 9. Log enrichment summary
  logEnrichmentSummary(prospect.name, {
    sourcesAttempted,
    sourcesSucceeded: dataSources,
    sourcesFailed: sourcesFailedReasons,
    emailResult: emailResultStr,
    confidenceScore: merged.dataConfidenceScore ?? 0,
  });

  return {
    enrichmentData: merged,
    enrichmentStatus,
    emailDiscoveryMethod,
    emailDiscoverySteps,
    companyResolvedVia,
  };
}
