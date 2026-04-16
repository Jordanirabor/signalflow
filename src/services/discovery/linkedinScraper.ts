// ============================================================
// LinkedIn Enrichment Adapter — Uses Serper.dev Google Search API
// Searches Google for LinkedIn profile data from search snippets.
// No Playwright, no CAPTCHAs.
// ============================================================

import type { ExtendedEnrichmentData, ProspectContext, SourceAdapter } from './types';

import { acquirePermit, recordRequest } from './rateLimiter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERPER_API_URL = 'https://google.serper.dev/search';
const RATE_LIMIT_SOURCE = 'linkedin';

// ---------------------------------------------------------------------------
// LinkedIn Profile Data
// ---------------------------------------------------------------------------

export interface LinkedInProfileData {
  headline: string;
  summary: string;
  currentJobTitle: string;
  activityPosts: string[];
  photoUrl: string;
  connectionCount: string;
  experienceEntries: LinkedInExperienceEntry[];
}

export interface LinkedInExperienceEntry {
  company: string;
  role: string;
  duration: string;
}

// ---------------------------------------------------------------------------
// Serper Response Types
// ---------------------------------------------------------------------------

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperResponse {
  organic?: SerperResult[];
}

// ---------------------------------------------------------------------------
// Snippet Parsing Helpers
// ---------------------------------------------------------------------------

/**
 * Extract headline and summary from a Google snippet for a LinkedIn profile.
 *
 * LinkedIn snippets typically look like:
 *   "Jane Doe - Senior Engineer at Acme Corp · Experienced software engineer
 *    with 10+ years in distributed systems..."
 *
 * We split on common separators to pull out the headline (title at company)
 * and any remaining summary text.
 */
function parseLinkedInSnippet(snippet: string): { headline: string; summary: string } {
  if (!snippet?.trim()) return { headline: '', summary: '' };

  const cleaned = snippet.replace(/\s+/g, ' ').trim();

  // Try splitting on " - " first (Name - Title at Company · summary)
  const dashSeparators = [' - ', ' – ', ' — '];
  let afterName = cleaned;

  for (const sep of dashSeparators) {
    const idx = cleaned.indexOf(sep);
    if (idx > 0 && idx < 80) {
      afterName = cleaned.slice(idx + sep.length).trim();
      break;
    }
  }

  // Split headline from summary on " · " or ". " or " | "
  const summarySeparators = [' · ', ' · ', '. ', ' | '];
  for (const sep of summarySeparators) {
    const idx = afterName.indexOf(sep);
    if (idx > 0) {
      return {
        headline: afterName.slice(0, idx).trim(),
        summary: afterName.slice(idx + sep.length).trim(),
      };
    }
  }

  // No summary separator found — treat the whole thing as headline
  return { headline: afterName, summary: '' };
}

// ---------------------------------------------------------------------------
// Exported Helper — mapProfileToEnrichment
// ---------------------------------------------------------------------------

/**
 * Maps extracted LinkedIn profile data to partial EnrichmentData.
 * Exported for testing.
 *
 * - headline + summary → linkedinBio
 * - activity posts → recentPosts
 */
export function mapProfileToEnrichment(
  profile: LinkedInProfileData,
): Partial<ExtendedEnrichmentData> {
  const result: Partial<ExtendedEnrichmentData> = {};

  // Build linkedinBio from headline + summary
  const parts: string[] = [];
  if (profile.headline.trim()) {
    parts.push(profile.headline.trim());
  }
  if (profile.summary.trim()) {
    parts.push(profile.summary.trim());
  }
  if (parts.length > 0) {
    result.linkedinBio = parts.join('\n\n');
  }

  // Map activity posts to recentPosts
  if (profile.activityPosts.length > 0) {
    result.recentPosts = [...profile.activityPosts];
  }

  result.dataSources = ['linkedin_scrape'];

  return result;
}

// ---------------------------------------------------------------------------
// Serper Search Helper
// ---------------------------------------------------------------------------

/**
 * Search Google via Serper.dev and return the top organic results.
 */
async function searchSerper(query: string, apiKey: string): Promise<SerperResult[]> {
  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 5 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Serper API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as SerperResponse;
  return data.organic ?? [];
}

/**
 * Find the best LinkedIn profile result from Serper results.
 * Prefers results whose link matches the prospect's linkedinUrl if provided.
 */
function findBestLinkedInResult(
  results: SerperResult[],
  linkedinUrl?: string,
): SerperResult | null {
  // Filter to linkedin.com/in/ results only
  const linkedinResults = results.filter((r) => r.link.includes('linkedin.com/in/'));
  if (linkedinResults.length === 0) return null;

  // If we have a known URL, prefer the matching result
  if (linkedinUrl) {
    const normalized = linkedinUrl.toLowerCase().replace(/\/+$/, '');
    const exact = linkedinResults.find(
      (r) => r.link.toLowerCase().replace(/\/+$/, '') === normalized,
    );
    if (exact) return exact;
  }

  // Otherwise return the top LinkedIn result
  return linkedinResults[0];
}

// ---------------------------------------------------------------------------
// LinkedIn Scraper — Source Adapter (Serper-based)
// ---------------------------------------------------------------------------

export const linkedinScraper: SourceAdapter = {
  name: 'linkedin_scrape',
  capabilities: ['enrichment'],

  isEnabled(): boolean {
    // Requires SERPER_API_KEY to function
    const serperKey = process.env.SERPER_API_KEY;
    if (!serperKey || serperKey.length === 0) return false;

    // LINKEDIN_SCRAPING_ENABLED defaults to true
    const envVal = process.env.LINKEDIN_SCRAPING_ENABLED;
    return envVal === undefined || envVal === '' || envVal.toLowerCase() === 'true';
  },

  async enrich(prospect: ProspectContext): Promise<Partial<ExtendedEnrichmentData>> {
    if (!this.isEnabled()) {
      console.log('[LinkedInScraper] Adapter is disabled, skipping enrichment');
      return {};
    }

    const apiKey = process.env.SERPER_API_KEY!;

    try {
      await acquirePermit(RATE_LIMIT_SOURCE);

      // Build the search query
      let query: string;
      if (prospect.linkedinUrl) {
        // Search for the specific LinkedIn URL to get its snippet
        query = prospect.linkedinUrl;
      } else {
        // Search by name + company on LinkedIn
        query = `${prospect.name} ${prospect.company} site:linkedin.com/in/`;
      }

      console.log(`[LinkedInScraper] Searching Serper: "${query.slice(0, 80)}"`);

      const results = await searchSerper(query, apiKey);
      recordRequest(RATE_LIMIT_SOURCE);

      const best = findBestLinkedInResult(results, prospect.linkedinUrl);
      if (!best) {
        console.log(`[LinkedInScraper] No LinkedIn result found for ${prospect.name}`);
        return {};
      }

      // Parse the snippet to extract headline and summary
      const { headline, summary } = parseLinkedInSnippet(best.snippet);

      const profileData: LinkedInProfileData = {
        headline,
        summary,
        currentJobTitle: headline,
        activityPosts: [], // Can't get activity from Google snippets
        photoUrl: '',
        connectionCount: '',
        experienceEntries: [],
      };

      const enrichment = mapProfileToEnrichment(profileData);

      // Set the linkedinUrl (from result or prospect)
      enrichment.linkedinUrl = prospect.linkedinUrl || best.link;

      console.log(
        `[LinkedInScraper] Enrichment complete for ${prospect.name}: ` +
          `headline="${headline}", url="${enrichment.linkedinUrl}"`,
      );

      return enrichment;
    } catch (error) {
      console.error(
        `[LinkedInScraper] Enrichment error for ${prospect.name}:`,
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  },
};
