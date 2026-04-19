// ============================================================
// Discovery Engine — Orchestrates multi-source lead discovery
// ============================================================

import type { ICPProfile } from '@/types';
import type {
  AnnotatedQuery,
  DiscoveredLeadData,
  ICP,
  QueryRetryContext,
  SourceAdapter,
} from './types';

import { calculateLeadScoreV2 } from '../scoringService';
import { shuffleAdapterOrder } from './antiDetection';
import { logDiscoverySummary, logStructured } from './discoveryLogger';
import { isSourceAvailable, recordFailure, recordSuccess } from './healthMonitor';
import {
  generateCreativeQueries,
  generateQueriesForProfile,
  generateRefinedQueries,
  persistQueryHistory,
  sanitizeForSerper,
} from './queryGenerator';
import { acquirePermit, recordRequest } from './rateLimiter';
import { isObfuscatedName, resolveObfuscatedName } from './waterfallEmailFinder';

// Source adapters
import { directoryScraper } from './directoryScraper';
import { githubScraper } from './githubScraper';
import { googleSearchScraper } from './googleSearchScraper';
import { mapsScraper } from './mapsScraper';
import { apolloAdapter } from './premiumAdapters';
import { serpApiSearchAdapter } from './serpApiSearchAdapter';
import { twitterScraper } from './twitterScraper';

// ---------------------------------------------------------------------------
// All discovery-capable adapters
// ---------------------------------------------------------------------------

/** Browser-based scrapers that still need proxies (Playwright) */
const BROWSER_SCRAPERS: SourceAdapter[] = [googleSearchScraper, directoryScraper];

/** API-based adapters that work without proxies */
const API_ADAPTERS: SourceAdapter[] = [
  serpApiSearchAdapter,
  githubScraper,
  twitterScraper,
  mapsScraper,
  apolloAdapter,
];

/**
 * Get all discovery adapters, optionally skipping browser scrapers
 * when no proxies are configured (they'll just get CAPTCHA-blocked).
 */
function getDiscoveryAdapters(): SourceAdapter[] {
  const proxyEnabled = process.env.SCRAPING_PROXY_ENABLED?.toLowerCase() === 'true';
  const proxyList = (process.env.SCRAPING_PROXY_LIST ?? '')
    .split(',')
    .filter((s) => s.trim().length > 0);
  const hasProxies = proxyEnabled && proxyList.length > 0;

  if (!hasProxies) {
    const enabledBrowserScrapers = BROWSER_SCRAPERS.filter((a) => a.isEnabled());
    if (enabledBrowserScrapers.length > 0) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `No proxies configured — skipping ${enabledBrowserScrapers.length} browser-based scrapers (they will get CAPTCHA-blocked). Set SCRAPING_PROXY_ENABLED=true and SCRAPING_PROXY_LIST to enable.`,
      });
    }
    return [...API_ADAPTERS];
  }

  return [...BROWSER_SCRAPERS, ...API_ADAPTERS];
}

// ---------------------------------------------------------------------------
// Normalization & Deduplication Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a name + company pair for deduplication.
 * Lowercases, trims, and collapses whitespace.
 */
export function normalizeNameCompany(name: string, company: string): string {
  const normName = (name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  const normCompany = (company ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  return `${normName}|${normCompany}`;
}

/**
 * Merge two prospect records, preferring the most complete (non-empty) fields.
 * For each field, the value with more content wins. If both are non-empty,
 * the longer/more complete value is preferred.
 */
export function mergeProspects(
  existing: DiscoveredLeadData,
  incoming: DiscoveredLeadData,
): DiscoveredLeadData {
  return {
    name: pickBest(existing.name, incoming.name),
    role: pickBest(existing.role, incoming.role),
    company: pickBest(existing.company, incoming.company),
    industry: pickBest(existing.industry, incoming.industry),
    geography: pickBest(existing.geography, incoming.geography),
    discoverySource: mergeDiscoverySources(existing.discoverySource, incoming.discoverySource),
    linkedinUrl: pickBest(existing.linkedinUrl, incoming.linkedinUrl),
    companyDomain: pickBest(existing.companyDomain, incoming.companyDomain),
    twitterHandle: pickBest(existing.twitterHandle, incoming.twitterHandle),
    githubUsername: pickBest(existing.githubUsername, incoming.githubUsername),
  };
}

/**
 * Pick the "best" (most complete) value between two optional strings.
 * Prefers non-empty over empty, and longer over shorter when both are non-empty.
 */
function pickBest(a: string | undefined, b: string | undefined): string {
  const aVal = a?.trim() ?? '';
  const bVal = b?.trim() ?? '';
  if (!aVal) return bVal;
  if (!bVal) return aVal;
  return aVal.length >= bVal.length ? aVal : bVal;
}

/**
 * Merge discovery source identifiers. If both exist and differ,
 * combine them with a comma separator.
 */
function mergeDiscoverySources(a: string | undefined, b: string | undefined): string {
  const aVal = a?.trim() ?? '';
  const bVal = b?.trim() ?? '';
  if (!aVal) return bVal;
  if (!bVal) return aVal;
  if (aVal === bVal) return aVal;
  // Combine unique sources
  const sources = new Set([
    ...aVal.split(',').map((s) => s.trim()),
    ...bVal.split(',').map((s) => s.trim()),
  ]);
  return [...sources].filter(Boolean).join(',');
}

/**
 * Deduplicate an array of prospects by normalized name + company.
 * When duplicates are found, merges data preferring the most complete fields.
 */
export function deduplicateProspects(prospects: DiscoveredLeadData[]): DiscoveredLeadData[] {
  const map = new Map<string, DiscoveredLeadData>();

  for (const prospect of prospects) {
    const key = normalizeNameCompany(prospect.name, prospect.company);
    const existing = map.get(key);

    if (existing) {
      map.set(key, mergeProspects(existing, prospect));
    } else {
      map.set(key, { ...prospect });
    }
  }

  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Lead Quality Validation
// ---------------------------------------------------------------------------

/**
 * Check if a string looks like a real person name (not a company name).
 * Requires at least two words (first + last name) and rejects strings
 * that look like company names (contain Inc., LLC, Corp, etc.).
 */
export function isValidPersonName(name: string): boolean {
  if (!name || !name.trim()) return false;

  const trimmed = name.trim();

  // Reject if name is too long (likely a tagline or sentence)
  if (trimmed.length > 60) return false;

  // Reject obvious company name patterns
  const companyPatterns = /\b(inc\.?|llc|ltd\.?|corp\.?|gmbh|plc|limited|headquarters)\b/i;
  if (companyPatterns.test(trimmed)) return false;

  // Must have at least one word with 2+ characters
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1);
  if (words.length < 1) return false;

  return true;
}

/**
 * Check if a string looks like a real company name (not a job title, description, or generic term).
 * Returns false for values that are clearly not company names.
 */
export function isValidCompanyName(company: string): boolean {
  if (!company || company.trim().length < 2) return false;
  const lower = company.toLowerCase().trim();

  // Reject common job titles/descriptions mistakenly stored as company names
  const jobTitlePatterns =
    /^(software engineer|product manager|data scientist|data protection officer|chief .* officer|cto|ceo|cmo|cfo|coo|vp of|director of|head of|engineer|developer|designer|analyst|consultant|freelancer|self[- ]employed|unemployed|student|intern|not specified|mobile app.*expert|digital expert|.*and digital expert)$/i;
  if (jobTitlePatterns.test(lower)) return false;

  // Reject single generic industry words
  const genericTerms = [
    'technology',
    'finance',
    'healthcare',
    'saas',
    'it',
    'ai',
    'ml',
    'e-commerce',
    'ecommerce',
    'mobile applications',
  ];
  if (genericTerms.includes(lower)) return false;

  // Reject if it looks like a LinkedIn headline (contains "and" with generic terms on both sides)
  if (
    /^(mobile|digital|web|cloud|data|ai)\s+(app|application|expert|specialist|consultant)/i.test(
      lower,
    )
  )
    return false;

  return true;
}

/**
 * Filter discovered leads to only those with valid data quality.
 * Removes leads with:
 * - Missing or invalid person names (company names, single words)
 * - Name identical to company (maps scraper artifact)
 * - Invalid company names (job titles, generic terms)
 */
export function filterValidLeads(leads: DiscoveredLeadData[]): DiscoveredLeadData[] {
  return filterValidLeadsWithReasons(leads).valid;
}

/**
 * Filter discovered leads and track filter reasons for logging.
 * Returns both the valid leads and a record of filter reason → count.
 */
export function filterValidLeadsWithReasons(leads: DiscoveredLeadData[]): {
  valid: DiscoveredLeadData[];
  filterReasons: Record<string, number>;
} {
  const filterReasons: Record<string, number> = {};
  const valid = leads.filter((lead) => {
    // Must have a valid person name
    if (!isValidPersonName(lead.name)) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Filtered out invalid name: "${lead.name}"`,
        source: lead.discoverySource,
      });
      filterReasons['invalid_name'] = (filterReasons['invalid_name'] ?? 0) + 1;
      return false;
    }

    // Name must not be the same as company (maps scraper artifact)
    if (lead.company && lead.name.trim().toLowerCase() === lead.company.trim().toLowerCase()) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Filtered out name=company: "${lead.name}"`,
        source: lead.discoverySource,
      });
      filterReasons['name_equals_company'] = (filterReasons['name_equals_company'] ?? 0) + 1;
      return false;
    }

    // Clean up invalid company names — clear them rather than filtering the lead
    if (lead.company && !isValidCompanyName(lead.company)) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Cleared invalid company name: "${lead.company}" for "${lead.name}"`,
        source: lead.discoverySource,
      });
      lead.company = '';
    }

    return true;
  });

  return { valid, filterReasons };
}

// ---------------------------------------------------------------------------
// Main Discovery Function
// ---------------------------------------------------------------------------

/**
 * Discover leads matching the given ICP by coordinating all enabled source adapters.
 *
 * 1. Generates search queries from the ICP via the Query Generator
 * 2. Filters to enabled + healthy adapters
 * 3. Shuffles adapter execution order (anti-detection)
 * 4. Executes each adapter with health monitoring and rate limiting
 * 5. Merges and deduplicates results
 * 6. Returns DiscoveredLeadData[] with discoverySource attached
 */
export async function discoverLeads(icp: ICP): Promise<DiscoveredLeadData[]> {
  // Metrics tracking for discovery summary
  const resultsPerSource: Record<string, number> = {};

  // 1. Filter to enabled adapters
  const enabledAdapters = getDiscoveryAdapters().filter((adapter) => adapter.isEnabled());

  if (enabledAdapters.length === 0) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'discovery',
      level: 'error',
      message: 'All discovery sources are disabled. Returning empty result set.',
    });
    return [];
  }

  // 2. Generate search queries from ICP
  let queries: AnnotatedQuery[];
  try {
    const result = await generateCreativeQueries(icp, icp.id);
    queries = result.queries;
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'discovery',
      level: 'info',
      message: `Generated ${queries.length} queries via ${result.generationMethod}`,
    });
  } catch (error) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'discovery',
      level: 'error',
      message: `Query generation failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return [];
  }

  // 3. Shuffle adapter order for anti-detection
  const shuffledAdapters = shuffleAdapterOrder(enabledAdapters);

  // 4. Execute each adapter
  const allProspects: DiscoveredLeadData[] = [];

  for (const adapter of shuffledAdapters) {
    // Check source health before calling
    if (!isSourceAvailable(adapter.name)) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Source "${adapter.name}" is unavailable (circuit breaker). Skipping.`,
        source: adapter.name,
      });
      continue;
    }

    try {
      // Apply rate limiting
      await acquirePermit(adapter.name);

      // Execute discovery
      const results = adapter.discover ? await adapter.discover(queries, icp) : [];

      // Record the request
      recordRequest(adapter.name);

      // Track results per source
      resultsPerSource[adapter.name] = (resultsPerSource[adapter.name] ?? 0) + results.length;

      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Source "${adapter.name}" returned ${results.length} results.`,
        source: adapter.name,
        metadata: { resultCount: results.length },
      });

      // Attach discoverySource to each result if not already set
      const taggedResults = results.map((prospect) => ({
        ...prospect,
        discoverySource: prospect.discoverySource || adapter.name,
      }));

      allProspects.push(...taggedResults);

      // Record success with health monitor
      recordSuccess(adapter.name);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check if this is a Serper 400 error — retry with sanitized queries
      if (errorMsg.includes('400') || errorMsg.includes('Bad Request')) {
        logStructured({
          timestamp: new Date().toISOString(),
          stage: 'discovery',
          level: 'warn',
          message: `Source "${adapter.name}" got Serper 400 error. Sanitizing queries and retrying once.`,
          source: adapter.name,
        });

        try {
          const sanitizedQueries = queries.map((q) => ({
            ...q,
            query: sanitizeForSerper(q.query),
          }));
          const retryResults = adapter.discover
            ? await adapter.discover(sanitizedQueries, icp)
            : [];
          recordRequest(adapter.name);
          resultsPerSource[adapter.name] =
            (resultsPerSource[adapter.name] ?? 0) + retryResults.length;

          const taggedRetryResults = retryResults.map((prospect) => ({
            ...prospect,
            discoverySource: prospect.discoverySource || adapter.name,
          }));
          allProspects.push(...taggedRetryResults);
          recordSuccess(adapter.name);

          logStructured({
            timestamp: new Date().toISOString(),
            stage: 'discovery',
            level: 'info',
            message: `Serper 400 retry for "${adapter.name}" returned ${retryResults.length} results.`,
            source: adapter.name,
          });
          continue;
        } catch (retryError) {
          logStructured({
            timestamp: new Date().toISOString(),
            stage: 'discovery',
            level: 'error',
            message: `Serper 400 retry for "${adapter.name}" also failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
            source: adapter.name,
          });
        }
      }

      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'error',
        message: `Source "${adapter.name}" failed: ${errorMsg}`,
        source: adapter.name,
      });

      // Record failure with health monitor
      recordFailure(adapter.name);

      // Continue with remaining adapters
    }
  }

  // 4a. Persist query history (graceful — errors logged, not thrown)
  try {
    await persistQueryHistory(queries, icp.id);
  } catch (err) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'discovery',
      level: 'warn',
      message: `Failed to persist query history: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 4b. Resolve obfuscated Apollo names using LinkedIn results
  const apolloSourceName = 'apollo_api';
  const nonApolloProspects = allProspects.filter((p) => p.discoverySource !== apolloSourceName);
  for (const prospect of allProspects) {
    if (prospect.discoverySource === apolloSourceName && isObfuscatedName(prospect.name)) {
      const resolved = resolveObfuscatedName(prospect.name, prospect.company, nonApolloProspects);
      if (resolved !== prospect.name) {
        logStructured({
          timestamp: new Date().toISOString(),
          stage: 'discovery',
          level: 'info',
          message: `Resolved obfuscated Apollo name "${prospect.name}" → "${resolved}"`,
          source: apolloSourceName,
        });
        prospect.name = resolved;
      }
    }
  }

  // 5. Deduplicate by normalized name + company, merging data
  const deduplicated = deduplicateProspects(allProspects);

  // 6. Filter to valid leads only (real person names, not company names)
  const { valid: validated, filterReasons } = filterValidLeadsWithReasons(deduplicated);

  logStructured({
    timestamp: new Date().toISOString(),
    stage: 'discovery',
    level: 'info',
    message: `Initial pass: ${validated.length} valid prospects from ${deduplicated.length} deduplicated (${allProspects.length} raw) across ${shuffledAdapters.length} sources. Filtered out ${deduplicated.length - validated.length} low-quality leads.`,
    metadata: {
      validCount: validated.length,
      deduplicatedCount: deduplicated.length,
      rawCount: allProspects.length,
    },
  });

  // 7. Retry with refined queries if valid leads < 3
  if (validated.length < 3) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'discovery',
      level: 'info',
      message: `Low yield detected (${validated.length} valid leads < 3). Generating refined queries for retry pass.`,
    });

    // Determine which vectors are missing from initial results
    const discoveredVectors = new Set(queries.map((q) => q.vector));
    const allVectors = ['linkedin', 'directory', 'github', 'twitter', 'maps', 'general'] as const;
    const missingVectors = allVectors.filter((v) => !discoveredVectors.has(v));

    const retryContext: QueryRetryContext = {
      previousQueries: queries,
      resultsCount: validated.length,
      missingVectors,
      feedback:
        validated.length === 0
          ? 'No valid leads found in initial discovery pass'
          : `Only ${validated.length} valid lead(s) found. Need more diverse results.`,
    };

    try {
      const refinedResult = await generateRefinedQueries(icp, retryContext);
      const refinedQueries = refinedResult.queries;
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Generated ${refinedQueries.length} refined queries via ${refinedResult.generationMethod} for retry pass.`,
      });

      // Execute second discovery pass with refined queries
      const retryProspects: DiscoveredLeadData[] = [];
      const retryAdapters = shuffleAdapterOrder(enabledAdapters);

      for (const adapter of retryAdapters) {
        if (!isSourceAvailable(adapter.name)) {
          continue;
        }

        try {
          await acquirePermit(adapter.name);
          const results = adapter.discover ? await adapter.discover(refinedQueries, icp) : [];
          recordRequest(adapter.name);

          // Track retry results per source
          resultsPerSource[adapter.name] = (resultsPerSource[adapter.name] ?? 0) + results.length;

          if (results.length > 0) {
            logStructured({
              timestamp: new Date().toISOString(),
              stage: 'discovery',
              level: 'info',
              message: `Retry pass — source "${adapter.name}" returned ${results.length} results.`,
              source: adapter.name,
              metadata: { resultCount: results.length, pass: 'retry' },
            });
          }

          const taggedResults = results.map((prospect) => ({
            ...prospect,
            discoverySource: prospect.discoverySource || adapter.name,
          }));

          retryProspects.push(...taggedResults);
          recordSuccess(adapter.name);
        } catch (error) {
          logStructured({
            timestamp: new Date().toISOString(),
            stage: 'discovery',
            level: 'error',
            message: `Retry pass — source "${adapter.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
            source: adapter.name,
          });
          recordFailure(adapter.name);
        }
      }

      // Merge results from both passes and deduplicate
      const mergedProspects = [...allProspects, ...retryProspects];
      const mergedDeduplicated = deduplicateProspects(mergedProspects);
      const { valid: mergedValidated, filterReasons: mergedFilterReasons } =
        filterValidLeadsWithReasons(mergedDeduplicated);

      // Combine filter reasons from both passes
      const combinedFilterReasons: Record<string, number> = { ...filterReasons };
      for (const [reason, count] of Object.entries(mergedFilterReasons)) {
        combinedFilterReasons[reason] = (combinedFilterReasons[reason] ?? 0) + count;
      }

      const totalQueries = queries.length + refinedQueries.length;

      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Discovery complete (with retry): ${mergedValidated.length} valid prospects from ${mergedDeduplicated.length} deduplicated (${mergedProspects.length} raw).`,
      });

      // Log discovery summary
      logDiscoverySummary({
        totalQueries,
        resultsPerSource,
        leadsExtracted: mergedProspects.length,
        leadsFiltered: mergedDeduplicated.length - mergedValidated.length,
        filterReasons: combinedFilterReasons,
        leadsDeduplicated: mergedDeduplicated.length,
      });

      return mergedValidated;
    } catch (error) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'error',
        message: `Retry query generation failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      // Fall through to return initial results
    }
  }

  logStructured({
    timestamp: new Date().toISOString(),
    stage: 'discovery',
    level: 'info',
    message: `Discovery complete: ${validated.length} valid prospects.`,
  });

  // Log discovery summary
  logDiscoverySummary({
    totalQueries: queries.length,
    resultsPerSource,
    leadsExtracted: allProspects.length,
    leadsFiltered: deduplicated.length - validated.length,
    filterReasons,
    leadsDeduplicated: deduplicated.length,
  });

  return validated;
}

// ---------------------------------------------------------------------------
// Multi-ICP Discovery Types
// ---------------------------------------------------------------------------

export interface MultiICPDiscoveryResult {
  prospects: (DiscoveredLeadData & { icpProfileId: string; score: number })[];
  profileResults: Map<string, number>; // profileId → count discovered
}

// ---------------------------------------------------------------------------
// Multi-ICP Discovery Function
// ---------------------------------------------------------------------------

/**
 * Discover leads across multiple ICP profiles with global cap enforcement.
 *
 * 1. Distributes daily cap proportionally across profiles (floor + round-robin remainder)
 * 2. Generates queries for each profile via generateQueriesForProfile
 * 3. Executes discovery across all queries, tagging each prospect with originating icpProfileId
 * 4. Deduplicates across profiles using normalizeNameCompany
 * 5. For duplicates, scores against each matching profile and keeps highest-scoring association
 * 6. Enforces global cap across all profiles
 * 7. Returns MultiICPDiscoveryResult with prospects and per-profile counts
 */
export async function discoverLeadsMultiICP(
  profiles: ICPProfile[],
  dailyCap: number,
): Promise<MultiICPDiscoveryResult> {
  const profileResults = new Map<string, number>();

  if (profiles.length === 0 || dailyCap <= 0) {
    return { prospects: [], profileResults };
  }

  // Initialize per-profile counts
  for (const profile of profiles) {
    profileResults.set(profile.id, 0);
  }

  // 1. Distribute cap proportionally: floor(dailyCap / profiles.length), remainder round-robin
  const basePerProfile = Math.floor(dailyCap / profiles.length);
  const remainder = dailyCap % profiles.length;
  const profileCaps = profiles.map((_, i) => basePerProfile + (i < remainder ? 1 : 0));

  // 2. Generate queries for each profile and collect all tagged prospects
  type TaggedProspect = DiscoveredLeadData & { icpProfileId: string };
  const allTaggedProspects: TaggedProspect[] = [];

  // Get enabled adapters once
  const enabledAdapters = getDiscoveryAdapters().filter((adapter) => adapter.isEnabled());

  if (enabledAdapters.length === 0) {
    console.error(
      '[DiscoveryEngine] All discovery sources are disabled. Returning empty result set.',
    );
    return { prospects: [], profileResults };
  }

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const cap = profileCaps[i];

    if (cap <= 0) continue;

    // Generate queries for this profile using creative, history-aware generation
    let profileQueries: AnnotatedQuery[];
    try {
      const icp: ICP = {
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
      const icpWithSignals = {
        ...icp,
        painPoints: profile.painPoints,
        buyingSignals: profile.buyingSignals,
      };
      const result = await generateCreativeQueries(icpWithSignals, profile.id);
      profileQueries = result.queries;
      console.log(
        `[DiscoveryEngine] Profile "${profile.targetRole}" generated ${profileQueries.length} queries via ${result.generationMethod}`,
      );

      // If creative generation returned 0 queries, fall back to V2 profile generation
      if (profileQueries.length === 0) {
        console.warn(
          `[DiscoveryEngine] Creative generation returned 0 queries for "${profile.targetRole}", falling back to profile generation`,
        );
        const fallbackResult = await generateQueriesForProfile(profile);
        profileQueries = fallbackResult.queries;
        console.log(
          `[DiscoveryEngine] Profile "${profile.targetRole}" fallback generated ${profileQueries.length} queries via ${fallbackResult.generationMethod}`,
        );
      }
    } catch (error) {
      // Creative generation failed entirely — fall back to V2 profile generation
      console.error(
        `[DiscoveryEngine] Creative query generation failed for profile "${profile.targetRole}":`,
        error instanceof Error ? error.message : String(error),
        '— falling back to profile generation',
      );
      try {
        const fallbackResult = await generateQueriesForProfile(profile);
        profileQueries = fallbackResult.queries;
        console.log(
          `[DiscoveryEngine] Profile "${profile.targetRole}" fallback generated ${profileQueries.length} queries via ${fallbackResult.generationMethod}`,
        );
      } catch (fallbackError) {
        console.error(
          `[DiscoveryEngine] All query generation failed for profile "${profile.targetRole}":`,
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        );
        continue;
      }
    }

    // Execute discovery with adapters
    const shuffledAdapters = shuffleAdapterOrder(enabledAdapters);
    const profileProspects: DiscoveredLeadData[] = [];

    for (const adapter of shuffledAdapters) {
      if (!isSourceAvailable(adapter.name)) {
        continue;
      }

      try {
        await acquirePermit(adapter.name);

        const icp: ICP = {
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

        const results = adapter.discover ? await adapter.discover(profileQueries, icp) : [];
        recordRequest(adapter.name);

        const taggedResults = results.map((prospect) => ({
          ...prospect,
          discoverySource: prospect.discoverySource || adapter.name,
        }));

        profileProspects.push(...taggedResults);
        recordSuccess(adapter.name);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Check if this is a Serper 400 error — retry with sanitized queries
        if (errorMsg.includes('400') || errorMsg.includes('Bad Request')) {
          logStructured({
            timestamp: new Date().toISOString(),
            stage: 'discovery',
            level: 'warn',
            message: `Source "${adapter.name}" got Serper 400 for profile "${profile.targetRole}". Sanitizing queries and retrying once.`,
            source: adapter.name,
          });

          try {
            const sanitizedQueries = profileQueries.map((q) => ({
              ...q,
              query: sanitizeForSerper(q.query),
            }));

            const icp: ICP = {
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

            const retryResults = adapter.discover
              ? await adapter.discover(sanitizedQueries, icp)
              : [];
            recordRequest(adapter.name);

            const taggedRetryResults = retryResults.map((prospect) => ({
              ...prospect,
              discoverySource: prospect.discoverySource || adapter.name,
            }));
            profileProspects.push(...taggedRetryResults);
            recordSuccess(adapter.name);

            logStructured({
              timestamp: new Date().toISOString(),
              stage: 'discovery',
              level: 'info',
              message: `Serper 400 retry for "${adapter.name}" (profile "${profile.targetRole}") returned ${retryResults.length} results.`,
              source: adapter.name,
            });
            continue;
          } catch (retryError) {
            logStructured({
              timestamp: new Date().toISOString(),
              stage: 'discovery',
              level: 'error',
              message: `Serper 400 retry for "${adapter.name}" (profile "${profile.targetRole}") also failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
              source: adapter.name,
            });
          }
        }

        console.error(
          `[DiscoveryEngine] Source "${adapter.name}" failed for profile "${profile.targetRole}":`,
          errorMsg,
        );
        recordFailure(adapter.name);
      }
    }

    // Persist query history for this profile (graceful — errors logged, not thrown)
    try {
      await persistQueryHistory(profileQueries, profile.id);
    } catch (err) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'warn',
        message: `Failed to persist query history for profile "${profile.targetRole}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Tag each prospect with the originating icpProfileId
    for (const prospect of profileProspects) {
      allTaggedProspects.push({ ...prospect, icpProfileId: profile.id });
    }
  }

  // 3. Deduplicate across profiles using normalizeNameCompany
  // Group prospects by normalized key, tracking which profiles they came from
  const prospectsByKey = new Map<
    string,
    { prospect: DiscoveredLeadData; profileIds: Set<string> }
  >();

  for (const tagged of allTaggedProspects) {
    const key = normalizeNameCompany(tagged.name, tagged.company);
    const existing = prospectsByKey.get(key);

    if (existing) {
      existing.prospect = mergeProspects(existing.prospect, tagged);
      existing.profileIds.add(tagged.icpProfileId);
    } else {
      const { icpProfileId: _, ...prospectData } = tagged;
      prospectsByKey.set(key, {
        prospect: { ...prospectData },
        profileIds: new Set([tagged.icpProfileId]),
      });
    }
  }

  // 4. Filter to valid leads
  const validEntries: { prospect: DiscoveredLeadData; profileIds: Set<string> }[] = [];
  for (const entry of prospectsByKey.values()) {
    const [valid] = filterValidLeads([entry.prospect]);
    if (valid) {
      validEntries.push({ prospect: valid, profileIds: entry.profileIds });
    }
  }

  // 5. For each prospect, score against each matching profile and keep highest-scoring association
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const scoredProspects: (DiscoveredLeadData & { icpProfileId: string; score: number })[] = [];

  for (const { prospect, profileIds } of validEntries) {
    let bestProfileId = '';
    let bestScore = -1;

    for (const profileId of profileIds) {
      const profile = profileMap.get(profileId);
      if (!profile) continue;

      const scoringResult = calculateLeadScoreV2({
        lead: {
          role: prospect.role,
          industry: prospect.industry,
          geography: prospect.geography,
          company: prospect.company,
          enrichmentData: undefined,
        },
        icpProfile: profile,
      });

      if (scoringResult.totalScore > bestScore) {
        bestScore = scoringResult.totalScore;
        bestProfileId = profileId;
      }
    }

    if (bestProfileId) {
      scoredProspects.push({
        ...prospect,
        icpProfileId: bestProfileId,
        score: bestScore,
      });
    }
  }

  // 6. Enforce global cap — sort by score descending, take top dailyCap
  scoredProspects.sort((a, b) => b.score - a.score);
  const capped = scoredProspects.slice(0, dailyCap);

  // 7. Compute per-profile counts
  for (const prospect of capped) {
    const current = profileResults.get(prospect.icpProfileId) ?? 0;
    profileResults.set(prospect.icpProfileId, current + 1);
  }

  console.log(
    `[DiscoveryEngine] Multi-ICP discovery complete: ${capped.length} prospects from ${profiles.length} profiles (cap: ${dailyCap}). Per-profile: ${[...profileResults.entries()].map(([id, count]) => `${id.slice(0, 8)}=${count}`).join(', ')}`,
  );

  return { prospects: capped, profileResults };
}
