// ============================================================
// News Scraper — Source Adapter for Enrichment
// Uses Serper.dev Google News API for recent mentions of prospects/companies
// ============================================================

import type { ExtendedEnrichmentData, ProspectContext, SourceAdapter } from './types';

import { acquirePermit, recordRequest } from './rateLimiter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_SOURCE = 'google';
const SERPER_NEWS_URL = 'https://google.serper.dev/news';
const MAX_RESULTS = 5;

// ---------------------------------------------------------------------------
// Serper API Response Types
// ---------------------------------------------------------------------------

interface SerperNewsResult {
  title: string;
  source: string;
  date: string;
  snippet: string;
}

interface SerperNewsResponse {
  news?: SerperNewsResult[];
}

// ---------------------------------------------------------------------------
// Exported Helpers (for testing)
// ---------------------------------------------------------------------------

/**
 * Check whether a news snippet is relevant to the prospect.
 * Returns true iff the snippet contains the prospect's name or company name
 * (case-insensitive).
 */
export function isRelevantResult(
  snippet: string,
  prospectName: string,
  companyName: string,
): boolean {
  if (!snippet) return false;

  const lowerSnippet = snippet.toLowerCase();
  const lowerName = prospectName.toLowerCase().trim();
  const lowerCompany = companyName.toLowerCase().trim();

  if (lowerName && lowerSnippet.includes(lowerName)) return true;
  if (lowerCompany && lowerSnippet.includes(lowerCompany)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Format article as a recent post string
// ---------------------------------------------------------------------------

function formatArticleAsPost(article: SerperNewsResult): string {
  const parts: string[] = [];

  if (article.title) parts.push(article.title);

  const meta: string[] = [];
  if (article.source) meta.push(article.source);
  if (article.date) meta.push(article.date);

  if (meta.length > 0) {
    parts.push(`(${meta.join(' — ')})`);
  }

  if (article.snippet && article.snippet !== article.title) {
    parts.push(`— ${article.snippet}`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// News Scraper — Source Adapter
// ---------------------------------------------------------------------------

export const newsScraper: SourceAdapter = {
  name: 'news_scrape',
  capabilities: ['enrichment'],

  isEnabled(): boolean {
    return !!process.env.SERPER_API_KEY;
  },

  async enrich(prospect: ProspectContext): Promise<Partial<ExtendedEnrichmentData>> {
    if (!prospect.name || !prospect.company) {
      console.log('[NewsScraper] Missing prospect name or company, skipping enrichment');
      return {};
    }

    try {
      await acquirePermit(RATE_LIMIT_SOURCE);

      const query = `${prospect.name} ${prospect.company}`;
      const response = await fetch(SERPER_NEWS_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, num: MAX_RESULTS * 2 }),
      });

      recordRequest(RATE_LIMIT_SOURCE);

      if (!response.ok) {
        console.error(`[NewsScraper] Serper API error: ${response.status} ${response.statusText}`);
        return {};
      }

      const data: SerperNewsResponse = await response.json();
      const articles = data.news ?? [];

      if (articles.length === 0) {
        console.log(
          `[NewsScraper] No news results for "${prospect.name}" at "${prospect.company}"`,
        );
        return {};
      }

      // Filter articles by relevance — snippet must mention prospect or company
      const relevant = articles.filter((article) =>
        isRelevantResult(article.snippet, prospect.name, prospect.company),
      );

      if (relevant.length === 0) {
        console.log(
          `[NewsScraper] No relevant news results for "${prospect.name}" at "${prospect.company}" after filtering`,
        );
        return {};
      }

      // Format articles as recent post strings
      const recentPosts = relevant.slice(0, MAX_RESULTS).map(formatArticleAsPost);

      console.log(
        `[NewsScraper] Found ${recentPosts.length} relevant news articles for "${prospect.name}" at "${prospect.company}"`,
      );

      return {
        recentPosts,
        dataSources: ['news_scrape'],
      };
    } catch (error) {
      console.error(
        `[NewsScraper] Enrichment error for "${prospect.name}" at "${prospect.company}":`,
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  },
};
