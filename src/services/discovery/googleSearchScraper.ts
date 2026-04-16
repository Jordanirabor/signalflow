// ============================================================
// Google Search Scraper — Source Adapter for Discovery
// ============================================================

import type { Page } from 'playwright';

import type { AnnotatedQuery, DiscoveredLeadData, ICP, SourceAdapter } from './types';

import { getRandomDelay } from './antiDetection';
import { acquirePermit, recordRequest } from './rateLimiter';
import { closeBrowser, createPage, detectCaptcha, launchBrowser } from './scraperUtils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_SEARCH_BASE = 'https://www.google.com/search';
const PAGES_TO_SCRAPE = 3;
const RESULTS_PER_PAGE = 10;

/** Delay bounds for Google Search (seconds) */
const MIN_DELAY_SEC = 3;
const MAX_DELAY_SEC = 8;

/** Directory URL patterns */
const DIRECTORY_PATTERNS: { pattern: RegExp; source: string }[] = [
  { pattern: /crunchbase\.com\/organization\//i, source: 'crunchbase' },
  { pattern: /crunchbase\.com\/person\//i, source: 'crunchbase' },
  { pattern: /angel\.co\//i, source: 'angellist' },
  { pattern: /wellfound\.com\//i, source: 'angellist' },
  { pattern: /ycombinator\.com\/companies\//i, source: 'yc' },
];

// ---------------------------------------------------------------------------
// Exported Helper Functions (for testing)
// ---------------------------------------------------------------------------

/**
 * Classify a URL as 'linkedin', 'directory', or 'other'.
 */
export function classifyUrl(url: string): 'linkedin' | 'directory' | 'other' {
  if (url.includes('linkedin.com/in/')) {
    return 'linkedin';
  }
  for (const { pattern } of DIRECTORY_PATTERNS) {
    if (pattern.test(url)) {
      return 'directory';
    }
  }
  return 'other';
}

/**
 * Normalize a URL: lowercase and remove trailing slashes.
 */
export function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

/**
 * Deduplicate search results by normalized URL.
 * Keeps the first occurrence of each normalized URL.
 */
export function deduplicateResults(
  results: { url: string; title: string; snippet: string }[],
): { url: string; title: string; snippet: string }[] {
  const seen = new Set<string>();
  const deduped: { url: string; title: string; snippet: string }[] = [];

  for (const result of results) {
    const normalized = normalizeUrl(result.url);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(result);
    }
  }

  return deduped;
}

/**
 * Extract a person's name from a LinkedIn search snippet.
 * LinkedIn snippets typically start with the person's name followed by
 * a separator (dash, pipe, or newline) and their headline.
 */
export function extractNameFromSnippet(snippet: string): string | null {
  if (!snippet || snippet.trim().length === 0) {
    return null;
  }

  // LinkedIn snippets often follow: "Name - Title at Company" or "Name | Title"
  const separators = [' - ', ' – ', ' — ', ' | ', '\n'];
  for (const sep of separators) {
    const idx = snippet.indexOf(sep);
    if (idx > 0 && idx < 80) {
      const candidate = snippet.slice(0, idx).trim();
      // Basic validation: name should be 2-60 chars and contain a space (first + last)
      if (candidate.length >= 2 && candidate.length <= 60) {
        return candidate;
      }
    }
  }

  // Fallback: take the first line if it looks like a name (short, no URLs)
  const firstLine = snippet.split('\n')[0].trim();
  if (firstLine.length >= 2 && firstLine.length <= 60 && !firstLine.includes('http')) {
    return firstLine;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

/**
 * Build a Google Search URL for a given query and page offset.
 */
function buildSearchUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    q: query,
    start: String(page * RESULTS_PER_PAGE),
    num: String(RESULTS_PER_PAGE),
  });
  return `${GOOGLE_SEARCH_BASE}?${params.toString()}`;
}

/**
 * Extract search results from a Google Search results page.
 */
async function extractResults(page: Page): Promise<SearchResult[]> {
  return page.evaluate(() => {
    const results: { url: string; title: string; snippet: string }[] = [];

    // Google search result containers
    const resultElements = document.querySelectorAll('div.g');

    for (const el of resultElements) {
      const linkEl = el.querySelector('a[href]');
      const titleEl = el.querySelector('h3');
      const snippetEl =
        el.querySelector('[data-sncf]') ||
        el.querySelector('.VwiC3b') ||
        el.querySelector('.IsZvec') ||
        el.querySelector('span.st');

      const url = linkEl?.getAttribute('href') ?? '';
      const title = titleEl?.textContent?.trim() ?? '';
      const snippet = snippetEl?.textContent?.trim() ?? '';

      if (url && url.startsWith('http') && title) {
        results.push({ url, title, snippet });
      }
    }

    return results;
  });
}

/**
 * Wait a randomized delay between 3 and 8 seconds (Google Search specific).
 */
async function waitGoogleDelay(page: Page): Promise<void> {
  const delaySec = getRandomDelay(MIN_DELAY_SEC, MAX_DELAY_SEC);
  await page.waitForTimeout(delaySec * 1000);
}

/**
 * Convert a LinkedIn search result into a DiscoveredLeadData.
 */
function linkedinResultToLead(result: SearchResult, icp: ICP): DiscoveredLeadData | null {
  const name = extractNameFromSnippet(result.snippet);
  if (!name) return null;

  // Try to extract headline from snippet (after the name separator)
  let headline = '';
  const separators = [' - ', ' – ', ' — ', ' | '];
  for (const sep of separators) {
    const idx = result.snippet.indexOf(sep);
    if (idx > 0) {
      headline = result.snippet.slice(idx + sep.length).trim();
      break;
    }
  }

  return {
    name,
    role: headline || icp.targetRole,
    company: '',
    industry: icp.industry,
    geography: icp.geography,
    discoverySource: 'google_search',
    linkedinUrl: result.url,
  };
}

// ---------------------------------------------------------------------------
// Google Search Scraper — Source Adapter
// ---------------------------------------------------------------------------

export const googleSearchScraper: SourceAdapter = {
  name: 'google_search',
  capabilities: ['discovery'],

  isEnabled(): boolean {
    const envVal = process.env.GOOGLE_SEARCH_ENABLED;
    // Default to true if not set
    return envVal === undefined || envVal === '' || envVal.toLowerCase() === 'true';
  },

  async discover(queries: AnnotatedQuery[], icp: ICP): Promise<DiscoveredLeadData[]> {
    if (!this.isEnabled()) {
      console.log('[GoogleSearchScraper] Adapter is disabled, skipping discovery');
      return [];
    }

    const allResults: SearchResult[] = [];
    const directoryUrls: string[] = [];
    const leads: DiscoveredLeadData[] = [];

    const browser = await launchBrowser();
    let consecutiveCaptchas = 0;
    const MAX_CONSECUTIVE_CAPTCHAS = 3;

    try {
      for (const annotatedQuery of queries) {
        // Bail early if we keep hitting CAPTCHAs — no point burning time
        if (consecutiveCaptchas >= MAX_CONSECUTIVE_CAPTCHAS) {
          console.warn(
            `[GoogleSearchScraper] ${MAX_CONSECUTIVE_CAPTCHAS} consecutive CAPTCHAs — aborting remaining queries. Consider enabling proxies (SCRAPING_PROXY_ENABLED=true).`,
          );
          break;
        }

        let captchaHit = false;

        for (let pageNum = 0; pageNum < PAGES_TO_SCRAPE; pageNum++) {
          try {
            await acquirePermit('google');

            const searchUrl = buildSearchUrl(annotatedQuery.query, pageNum);
            const page = await createPage(browser, 'www.google.com');

            try {
              await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

              // Check for CAPTCHA
              if (await detectCaptcha(page)) {
                console.warn(
                  `[GoogleSearchScraper] CAPTCHA detected for query "${annotatedQuery.query}" on page ${pageNum + 1}. Aborting query.`,
                );
                captchaHit = true;
                await page.context().close();
                break;
              }

              const pageResults = await extractResults(page);
              recordRequest('google');

              allResults.push(...pageResults);

              // Wait between page loads
              if (pageNum < PAGES_TO_SCRAPE - 1) {
                await waitGoogleDelay(page);
              }
            } finally {
              await page.context().close();
            }
          } catch (error) {
            console.error(
              `[GoogleSearchScraper] Error scraping page ${pageNum + 1} for query "${annotatedQuery.query}":`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }

        if (captchaHit) {
          consecutiveCaptchas++;
          console.log(
            `[GoogleSearchScraper] Continuing with remaining queries after CAPTCHA on "${annotatedQuery.query}" (${consecutiveCaptchas}/${MAX_CONSECUTIVE_CAPTCHAS} consecutive)`,
          );
        } else {
          consecutiveCaptchas = 0; // Reset on successful query
        }
      }

      // Deduplicate all collected results
      const dedupedResults = deduplicateResults(allResults);

      // Classify and process results
      for (const result of dedupedResults) {
        const classification = classifyUrl(result.url);

        if (classification === 'linkedin') {
          const lead = linkedinResultToLead(result, icp);
          if (lead) {
            leads.push(lead);
          }
        } else if (classification === 'directory') {
          directoryUrls.push(result.url);
        }
      }

      // Log directory URLs for downstream processing
      if (directoryUrls.length > 0) {
        console.log(
          `[GoogleSearchScraper] Found ${directoryUrls.length} directory URLs for Directory Scraper`,
        );
      }
    } finally {
      await closeBrowser(browser);
    }

    console.log(
      `[GoogleSearchScraper] Discovery complete: ${leads.length} leads from ${allResults.length} raw results`,
    );

    return leads;
  },
};
