// ============================================================
// SERP API Search Adapter — Uses Serper.dev for Google Search
// No Playwright needed, no CAPTCHAs, structured JSON response
// Free tier: 2,500 queries
// ============================================================

import type { AnnotatedQuery, DiscoveredLeadData, ICP, SourceAdapter } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERPER_API_URL = 'https://google.serper.dev/search';

// ---------------------------------------------------------------------------
// Response Types
// ---------------------------------------------------------------------------

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperResponse {
  organic?: SerperResult[];
  searchParameters?: { q: string };
}

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Classify a URL as 'linkedin', 'directory', or 'other'.
 */
export function classifyUrl(url: string): 'linkedin' | 'directory' | 'other' {
  if (url.includes('linkedin.com/in/')) return 'linkedin';
  if (/crunchbase\.com\/(organization|person)\//i.test(url)) return 'directory';
  if (/angel\.co\//i.test(url) || /wellfound\.com\//i.test(url)) return 'directory';
  if (/ycombinator\.com\/companies\//i.test(url)) return 'directory';
  return 'other';
}

/**
 * Extract a person's name from a LinkedIn search snippet.
 */
export function extractNameFromSnippet(snippet: string): string | null {
  if (!snippet?.trim()) return null;

  const separators = [' - ', ' – ', ' — ', ' | ', '\n'];
  for (const sep of separators) {
    const idx = snippet.indexOf(sep);
    if (idx > 0 && idx < 80) {
      const candidate = snippet.slice(0, idx).trim();
      if (candidate.length >= 2 && candidate.length <= 60) return candidate;
    }
  }

  const firstLine = snippet.split('\n')[0].trim();
  if (firstLine.length >= 2 && firstLine.length <= 60 && !firstLine.includes('http')) {
    return firstLine;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SERP API Search Adapter
// ---------------------------------------------------------------------------

export const serpApiSearchAdapter: SourceAdapter = {
  name: 'serp_api_search',
  capabilities: ['discovery'],

  isEnabled(): boolean {
    const key = process.env.SERPER_API_KEY;
    return typeof key === 'string' && key.length > 0;
  },

  async discover(queries: AnnotatedQuery[], icp: ICP): Promise<DiscoveredLeadData[]> {
    if (!this.isEnabled()) {
      console.log('[SerpApiSearch] No SERPER_API_KEY configured, skipping');
      return [];
    }

    const apiKey = process.env.SERPER_API_KEY!;
    const leads: DiscoveredLeadData[] = [];
    const seenUrls = new Set<string>();

    console.log(`[SerpApiSearch] Starting discovery with ${queries.length} queries`);

    for (const annotatedQuery of queries) {
      try {
        const response = await fetch(SERPER_API_URL, {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            q: annotatedQuery.query,
            num: 30,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          console.error(`[SerpApiSearch] API error ${response.status}: ${body.slice(0, 200)}`);
          continue;
        }

        const data = (await response.json()) as SerperResponse;
        const results = data.organic ?? [];

        console.log(
          `[SerpApiSearch] Query "${annotatedQuery.query.slice(0, 60)}..." returned ${results.length} results`,
        );

        for (const result of results) {
          const normalizedUrl = result.link.toLowerCase().replace(/\/+$/, '');
          if (seenUrls.has(normalizedUrl)) continue;
          seenUrls.add(normalizedUrl);

          const classification = classifyUrl(result.link);

          if (classification === 'linkedin') {
            const name = extractNameFromSnippet(result.snippet);
            if (!name) continue;

            // Extract headline from snippet — often contains "Role at Company"
            let headline = '';
            let company = '';
            for (const sep of [' - ', ' – ', ' — ', ' | ']) {
              const idx = result.snippet.indexOf(sep);
              if (idx > 0) {
                headline = result.snippet.slice(idx + sep.length).trim();
                break;
              }
            }

            // Try to extract company from "Role at Company" pattern in headline
            const atMatch = headline.match(/\bat\s+(.+?)(?:\s*[·|–—-]|$)/i);
            if (atMatch) {
              company = atMatch[1].trim();
            }

            leads.push({
              name,
              role: headline || icp.targetRole,
              company,
              industry: icp.industry,
              geography: icp.geography,
              discoverySource: 'serp_api_search',
              linkedinUrl: result.link,
            });
          }
          // Directory URLs could be passed to directory scraper in the future
        }
      } catch (error) {
        console.error(
          `[SerpApiSearch] Error for query "${annotatedQuery.query.slice(0, 40)}":`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    console.log(`[SerpApiSearch] Discovery complete: ${leads.length} leads`);
    return leads;
  },
};
