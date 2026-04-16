// ============================================================
// Prospect Researcher Service — Deep research orchestration
// Aggregates content from multiple source adapters into a
// structured ResearchProfile for each lead.
// ============================================================

import { query } from '@/lib/db';
import type { ContentSummary, Lead, ResearchActivity, ResearchProfile } from '@/types';

// Existing source adapters from the enrichment pipeline
import { companyWebsiteScraper } from './discovery/companyWebsiteScraper';
import { linkedinScraper } from './discovery/linkedinScraper';
import { newsScraper } from './discovery/newsScraper';
import { twitterScraper } from './discovery/twitterScraper';

// Content extraction pipeline services
import { fetchAndExtract } from './contentFetcherService';
import { summarizeContent } from './contentSummarizerService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Overall research timeout in milliseconds (120 seconds) */
const RESEARCH_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Research Source Adapter Interface
// ---------------------------------------------------------------------------

/**
 * A research source adapter fetches content from a specific source
 * and returns partial research data for merging into a ResearchProfile.
 */
export interface ResearchSourceAdapter {
  name: string;
  fetch(lead: Lead): Promise<PartialResearchData>;
}

export interface PartialResearchData {
  topicsOfInterest?: string[];
  currentChallenges?: string[];
  recentActivity?: ResearchActivity[];
  publishedContentSummaries?: string[];
}

// ---------------------------------------------------------------------------
// Source Adapters — Wrappers around existing enrichment adapters
// ---------------------------------------------------------------------------

export const linkedinResearchAdapter: ResearchSourceAdapter = {
  name: 'linkedin',
  async fetch(lead: Lead): Promise<PartialResearchData> {
    const prospect = {
      name: lead.name,
      company: lead.company,
      linkedinUrl: lead.enrichmentData?.linkedinUrl,
    };
    const result = await linkedinScraper.enrich!(prospect);
    const activity: ResearchActivity[] = [];
    if (result.linkedinBio) {
      activity.push({
        summary: result.linkedinBio,
        source: 'linkedin',
        timestamp: new Date(),
      });
    }
    return {
      topicsOfInterest: result.recentPosts?.slice(0, 3) ?? [],
      recentActivity: activity,
    };
  },
};

export const twitterResearchAdapter: ResearchSourceAdapter = {
  name: 'twitter',
  async fetch(lead: Lead): Promise<PartialResearchData> {
    const prospect = {
      name: lead.name,
      company: lead.company,
    };
    // The twitter scraper is discovery-only; attempt enrichment via its enrich method if available
    if (twitterScraper.enrich) {
      const result = await twitterScraper.enrich(prospect);
      return {
        topicsOfInterest: result.recentPosts?.slice(0, 3) ?? [],
        recentActivity: (result.recentPosts ?? []).map((post) => ({
          summary: post,
          source: 'twitter',
          timestamp: new Date(),
        })),
      };
    }
    return {};
  },
};

export const newsResearchAdapter: ResearchSourceAdapter = {
  name: 'news',
  async fetch(lead: Lead): Promise<PartialResearchData> {
    const prospect = { name: lead.name, company: lead.company };
    const result = await newsScraper.enrich!(prospect);
    return {
      recentActivity: (result.recentPosts ?? []).map((post) => ({
        summary: post,
        source: 'news',
        timestamp: new Date(),
      })),
      publishedContentSummaries: result.recentPosts?.slice(0, 3) ?? [],
    };
  },
};

export const companyWebsiteResearchAdapter: ResearchSourceAdapter = {
  name: 'company_website',
  async fetch(lead: Lead): Promise<PartialResearchData> {
    const prospect = {
      name: lead.name,
      company: lead.company,
      companyDomain: lead.enrichmentData?.companyDomain,
    };
    const result = await companyWebsiteScraper.enrich!(prospect);
    const challenges: string[] = [];
    if (result.companyInfo) {
      challenges.push(result.companyInfo);
    }
    return {
      currentChallenges: challenges,
    };
  },
};

export const blogResearchAdapter: ResearchSourceAdapter = {
  name: 'blog',
  async fetch(lead: Lead): Promise<PartialResearchData> {
    // Blog adapter — searches for blog posts by the prospect
    const searchQuery = `${lead.name} ${lead.company} blog`;
    try {
      const apiKey = process.env.SERPER_API_KEY;
      if (!apiKey) return {};

      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: searchQuery, num: 5 }),
      });

      if (!response.ok) return {};

      const data = (await response.json()) as {
        organic?: { title: string; snippet: string; link: string }[];
      };
      const results = data.organic ?? [];
      const top3 = results.slice(0, 3);

      if (top3.length === 0) return {};

      // Fetch and extract content for top 3 URLs concurrently
      const extractionResults = await Promise.allSettled(
        top3.map(async (r) => {
          const text = await fetchAndExtract(r.link);
          return { result: r, text };
        }),
      );

      // Summarize each successfully extracted text
      const summaries: {
        result: { title: string; snippet: string; link: string };
        summary: ContentSummary;
      }[] = [];

      const summarizationResults = await Promise.allSettled(
        extractionResults.map(async (settled) => {
          if (settled.status !== 'fulfilled' || !settled.value.text) return null;
          const { result: serperResult, text } = settled.value;
          const summary = await summarizeContent(text, serperResult.link);
          if (summary) {
            return { result: serperResult, summary };
          }
          return null;
        }),
      );

      for (const settled of summarizationResults) {
        if (settled.status === 'fulfilled' && settled.value) {
          summaries.push(settled.value);
        }
      }

      // If we have at least one ContentSummary, build enriched data
      if (summaries.length > 0) {
        const publishedContentSummaries = summaries.map((s) => JSON.stringify(s.summary));
        const recentActivity: ResearchActivity[] = summaries.map((s) => ({
          summary: s.summary.synopsis,
          source: 'blog',
          timestamp: new Date(),
          url: s.summary.sourceUrl,
        }));
        const topicsOfInterest = [...new Set(summaries.flatMap((s) => s.summary.topics))];

        return {
          publishedContentSummaries,
          recentActivity,
          topicsOfInterest,
        };
      }

      // Fallback: all fetches/summarizations failed — use original Serper title + snippet
      return {
        publishedContentSummaries: top3.map((r) => `${r.title}: ${r.snippet}`),
        recentActivity: top3.map((r) => ({
          summary: `${r.title}: ${r.snippet}`,
          source: 'blog',
          timestamp: new Date(),
          url: r.link,
        })),
      };
    } catch {
      return {};
    }
  },
};

export const podcastResearchAdapter: ResearchSourceAdapter = {
  name: 'podcast',
  async fetch(lead: Lead): Promise<PartialResearchData> {
    // Podcast adapter — searches for podcast appearances
    const searchQuery = `${lead.name} ${lead.company} podcast interview`;
    try {
      const apiKey = process.env.SERPER_API_KEY;
      if (!apiKey) return {};

      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: searchQuery, num: 5 }),
      });

      if (!response.ok) return {};

      const data = (await response.json()) as {
        organic?: { title: string; snippet: string; link: string }[];
      };
      const results = data.organic ?? [];
      const top3 = results.slice(0, 3);

      if (top3.length === 0) return {};

      // Fetch and extract content for top 3 URLs concurrently
      const extractionResults = await Promise.allSettled(
        top3.map(async (r) => {
          const text = await fetchAndExtract(r.link);
          return { result: r, text };
        }),
      );

      // Summarize each successfully extracted text
      const summaries: {
        result: { title: string; snippet: string; link: string };
        summary: ContentSummary;
      }[] = [];

      const summarizationResults = await Promise.allSettled(
        extractionResults.map(async (settled) => {
          if (settled.status !== 'fulfilled' || !settled.value.text) return null;
          const { result: serperResult, text } = settled.value;
          const summary = await summarizeContent(text, serperResult.link);
          if (summary) {
            return { result: serperResult, summary };
          }
          return null;
        }),
      );

      for (const settled of summarizationResults) {
        if (settled.status === 'fulfilled' && settled.value) {
          summaries.push(settled.value);
        }
      }

      // If we have at least one ContentSummary, build enriched data
      if (summaries.length > 0) {
        const publishedContentSummaries = summaries.map((s) => JSON.stringify(s.summary));
        const recentActivity: ResearchActivity[] = summaries.map((s) => ({
          summary: s.summary.synopsis,
          source: 'podcast',
          timestamp: new Date(),
          url: s.summary.sourceUrl,
        }));
        const topicsOfInterest = [...new Set(summaries.flatMap((s) => s.summary.topics))];

        return {
          publishedContentSummaries,
          recentActivity,
          topicsOfInterest,
        };
      }

      // Fallback: all fetches/summarizations failed — use original Serper title + snippet
      return {
        publishedContentSummaries: top3.map((r) => `${r.title}: ${r.snippet}`),
        recentActivity: top3.map((r) => ({
          summary: `${r.title}: ${r.snippet}`,
          source: 'podcast',
          timestamp: new Date(),
          url: r.link,
        })),
      };
    } catch {
      return {};
    }
  },
};

export const conferenceResearchAdapter: ResearchSourceAdapter = {
  name: 'conference',
  async fetch(lead: Lead): Promise<PartialResearchData> {
    // Conference adapter — searches for conference talk appearances
    const searchQuery = `${lead.name} ${lead.company} conference talk speaker`;
    try {
      const apiKey = process.env.SERPER_API_KEY;
      if (!apiKey) return {};

      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: searchQuery, num: 5 }),
      });

      if (!response.ok) return {};

      const data = (await response.json()) as {
        organic?: { title: string; snippet: string; link: string }[];
      };
      const results = data.organic ?? [];
      const top3 = results.slice(0, 3);

      if (top3.length === 0) return {};

      // Fetch and extract content for top 3 URLs concurrently
      const extractionResults = await Promise.allSettled(
        top3.map(async (r) => {
          const text = await fetchAndExtract(r.link);
          return { result: r, text };
        }),
      );

      // Summarize each successfully extracted text
      const summaries: {
        result: { title: string; snippet: string; link: string };
        summary: ContentSummary;
      }[] = [];

      const summarizationResults = await Promise.allSettled(
        extractionResults.map(async (settled) => {
          if (settled.status !== 'fulfilled' || !settled.value.text) return null;
          const { result: serperResult, text } = settled.value;
          const summary = await summarizeContent(text, serperResult.link);
          if (summary) {
            return { result: serperResult, summary };
          }
          return null;
        }),
      );

      for (const settled of summarizationResults) {
        if (settled.status === 'fulfilled' && settled.value) {
          summaries.push(settled.value);
        }
      }

      // If we have at least one ContentSummary, build enriched data
      if (summaries.length > 0) {
        const publishedContentSummaries = summaries.map((s) => JSON.stringify(s.summary));
        const recentActivity: ResearchActivity[] = summaries.map((s) => ({
          summary: s.summary.synopsis,
          source: 'conference',
          timestamp: new Date(),
          url: s.summary.sourceUrl,
        }));
        const topicsOfInterest = [...new Set(summaries.flatMap((s) => s.summary.topics))];

        return {
          publishedContentSummaries,
          recentActivity,
          topicsOfInterest,
        };
      }

      // Fallback: all fetches/summarizations failed — use original Serper title + snippet
      return {
        publishedContentSummaries: top3.map((r) => `${r.title}: ${r.snippet}`),
        recentActivity: top3.map((r) => ({
          summary: `${r.title}: ${r.snippet}`,
          source: 'conference',
          timestamp: new Date(),
          url: r.link,
        })),
      };
    } catch {
      return {};
    }
  },
};

// ---------------------------------------------------------------------------
// All Research Adapters
// ---------------------------------------------------------------------------

export const ALL_RESEARCH_ADAPTERS: ResearchSourceAdapter[] = [
  linkedinResearchAdapter,
  twitterResearchAdapter,
  newsResearchAdapter,
  companyWebsiteResearchAdapter,
  blogResearchAdapter,
  podcastResearchAdapter,
  conferenceResearchAdapter,
];

// ---------------------------------------------------------------------------
// Timeout Helper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[ProspectResearcher] Timeout after ${ms}ms for ${label}`));
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
// Merge Partial Research Results
// ---------------------------------------------------------------------------

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Determine overall sentiment from available data.
 * Simple heuristic: defaults to 'neutral'.
 */
function determineSentiment(partials: PartialResearchData[]): 'positive' | 'neutral' | 'negative' {
  // Count activity volume as a rough proxy — more activity = positive engagement
  const totalActivity = partials.reduce((sum, p) => sum + (p.recentActivity?.length ?? 0), 0);
  if (totalActivity >= 5) return 'positive';
  if (totalActivity === 0) return 'neutral';
  return 'neutral';
}

export function mergeResearchResults(
  leadId: string,
  results: { adapterName: string; data: PartialResearchData }[],
  failedSources: string[],
): ResearchProfile {
  const topicsOfInterest: string[] = [];
  const currentChallenges: string[] = [];
  const recentActivity: ResearchActivity[] = [];
  const publishedContentSummaries: string[] = [];
  const sourcesUsed: string[] = [];

  for (const { adapterName, data } of results) {
    if (data.topicsOfInterest) topicsOfInterest.push(...data.topicsOfInterest);
    if (data.currentChallenges) currentChallenges.push(...data.currentChallenges);
    if (data.recentActivity) recentActivity.push(...data.recentActivity);
    if (data.publishedContentSummaries)
      publishedContentSummaries.push(...data.publishedContentSummaries);
    sourcesUsed.push(adapterName);
  }

  return {
    leadId,
    topicsOfInterest: dedup(topicsOfInterest),
    currentChallenges: dedup(currentChallenges),
    recentActivity,
    publishedContentSummaries: dedup(publishedContentSummaries),
    overallSentiment: determineSentiment(results.map((r) => r.data)),
    sourcesUsed: dedup(sourcesUsed),
    sourcesUnavailable: dedup(failedSources),
    researchedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Database Operations
// ---------------------------------------------------------------------------

/**
 * Set the lead's enrichment status.
 */
async function setEnrichmentStatus(
  leadId: string,
  status: 'researching' | 'complete' | 'partial',
): Promise<void> {
  await query(`UPDATE lead SET enrichment_status = $1, updated_at = NOW() WHERE id = $2`, [
    status,
    leadId,
  ]);
}

/**
 * Store the Research Profile as JSONB on the lead record.
 */
async function storeResearchProfile(leadId: string, profile: ResearchProfile): Promise<void> {
  await query(`UPDATE lead SET research_profile = $1, updated_at = NOW() WHERE id = $2`, [
    JSON.stringify(profile),
    leadId,
  ]);
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Research a prospect by executing all source adapters concurrently
 * with a 120-second overall timeout. Merges partial results into a
 * ResearchProfile. Records unavailable sources. Updates enrichment status.
 */
export async function researchProspect(
  lead: Lead,
  adapters: ResearchSourceAdapter[] = ALL_RESEARCH_ADAPTERS,
): Promise<ResearchProfile> {
  // Set status to "researching"
  await setEnrichmentStatus(lead.id, 'researching');

  // Execute all adapters concurrently with timeout
  const adapterPromises = adapters.map((adapter) =>
    withTimeout(
      adapter.fetch(lead).then((data) => ({ adapterName: adapter.name, data })),
      RESEARCH_TIMEOUT_MS,
      adapter.name,
    ),
  );

  const settled = await Promise.allSettled(adapterPromises);

  // Separate successes and failures
  const successfulResults: { adapterName: string; data: PartialResearchData }[] = [];
  const failedSources: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const adapter = adapters[i];

    if (result.status === 'fulfilled') {
      const { adapterName, data } = result.value;
      const hasContent =
        (data.topicsOfInterest?.length ?? 0) > 0 ||
        (data.currentChallenges?.length ?? 0) > 0 ||
        (data.recentActivity?.length ?? 0) > 0 ||
        (data.publishedContentSummaries?.length ?? 0) > 0;

      if (hasContent) {
        successfulResults.push({ adapterName, data });
      } else {
        failedSources.push(adapter.name);
      }
    } else {
      failedSources.push(adapter.name);
      console.error(
        `[ProspectResearcher] Adapter "${adapter.name}" failed for "${lead.name}":`,
        result.reason instanceof Error ? result.reason.message : String(result.reason),
      );
    }
  }

  // Merge results
  const profile = mergeResearchResults(lead.id, successfulResults, failedSources);

  // Store in database
  try {
    await storeResearchProfile(lead.id, profile);
  } catch (error) {
    console.error(
      `[ProspectResearcher] Failed to store research profile for "${lead.name}":`,
      error instanceof Error ? error.message : String(error),
    );
  }

  // Update enrichment status
  const finalStatus = successfulResults.length === 0 ? 'partial' : 'complete';
  await setEnrichmentStatus(lead.id, finalStatus);

  console.log(
    `[ProspectResearcher] Research for "${lead.name}" complete. ` +
      `Status: ${finalStatus}, Sources: ${successfulResults.length} succeeded, ${failedSources.length} failed.`,
  );

  return profile;
}

/**
 * Retrieve a stored Research Profile for a lead from the database.
 */
export async function getResearchProfile(leadId: string): Promise<ResearchProfile | null> {
  const result = await query<{ research_profile: ResearchProfile | null }>(
    `SELECT research_profile FROM lead WHERE id = $1 AND is_deleted = false`,
    [leadId],
  );

  if (result.rows.length === 0) return null;

  const raw = result.rows[0].research_profile;
  if (!raw) return null;

  // Ensure Date fields are properly deserialized
  return {
    ...raw,
    researchedAt: new Date(raw.researchedAt),
    recentActivity: (raw.recentActivity ?? []).map((a) => ({
      ...a,
      timestamp: new Date(a.timestamp),
    })),
  };
}

/**
 * Check if a Research Profile is stale (older than the given threshold in days).
 */
export function isResearchStale(profile: ResearchProfile, thresholdDays: number): boolean {
  const now = new Date();
  const researchedAt = new Date(profile.researchedAt);
  const diffMs = now.getTime() - researchedAt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > thresholdDays;
}
