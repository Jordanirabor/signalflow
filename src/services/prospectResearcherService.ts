// ============================================================
// Prospect Researcher Service — Deep research orchestration
// Aggregates content from multiple source adapters into a
// structured ResearchProfile for each lead.
// ============================================================

import { promises as dnsPromises } from 'dns';

import { query } from '@/lib/db';
import type { ContentSummary, Lead, ResearchActivity, ResearchProfile } from '@/types';
import OpenAI from 'openai';

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

/** Timeout for the OpenAI synthesis call in milliseconds (30 seconds) */
const SYNTHESIS_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton — same pattern as aiResultParser)
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
// Synthesized Profile Interface
// ---------------------------------------------------------------------------

export interface SynthesizedProfile {
  roleContext: string;
  topicsOfInterest: string[];
  currentChallenges: string[];
  recentActivity: ResearchActivity[];
  companyContext: string;
  potentialPainPoints: string[];
  publishedContentSummaries: string[];
}

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
// OpenAI Synthesis
// ---------------------------------------------------------------------------

/**
 * Build a text block aggregating all raw adapter results for the synthesis prompt.
 */
function aggregateRawResults(
  lead: Lead,
  rawResults: { adapterName: string; data: PartialResearchData }[],
): string {
  const sections: string[] = [];
  sections.push(`Prospect: ${lead.name}, ${lead.role} at ${lead.company}`);
  if (lead.industry) sections.push(`Industry: ${lead.industry}`);

  for (const { adapterName, data } of rawResults) {
    const parts: string[] = [];
    if (data.topicsOfInterest?.length) parts.push(`Topics: ${data.topicsOfInterest.join(', ')}`);
    if (data.currentChallenges?.length)
      parts.push(`Challenges: ${data.currentChallenges.join(', ')}`);
    if (data.recentActivity?.length)
      parts.push(`Activity: ${data.recentActivity.map((a) => a.summary).join('; ')}`);
    if (data.publishedContentSummaries?.length)
      parts.push(`Content: ${data.publishedContentSummaries.join('; ')}`);
    if (parts.length > 0) {
      sections.push(`\n--- Source: ${adapterName} ---\n${parts.join('\n')}`);
    }
  }

  return sections.join('\n');
}

/**
 * Build a fallback SynthesizedProfile from raw merged data (no OpenAI).
 */
function buildFallbackSynthesizedProfile(
  lead: Lead,
  rawResults: { adapterName: string; data: PartialResearchData }[],
): SynthesizedProfile {
  const topics: string[] = [];
  const challenges: string[] = [];
  const activity: ResearchActivity[] = [];
  const content: string[] = [];

  for (const { data } of rawResults) {
    if (data.topicsOfInterest) topics.push(...data.topicsOfInterest);
    if (data.currentChallenges) challenges.push(...data.currentChallenges);
    if (data.recentActivity) activity.push(...data.recentActivity);
    if (data.publishedContentSummaries) content.push(...data.publishedContentSummaries);
  }

  return {
    roleContext: `${lead.role} at ${lead.company}`,
    topicsOfInterest: [...new Set(topics)],
    currentChallenges: [...new Set(challenges)],
    recentActivity: activity,
    companyContext: lead.company,
    potentialPainPoints: [],
    publishedContentSummaries: [...new Set(content)],
  };
}

const SYNTHESIS_PROMPT = `You are a sales research analyst. Given raw research data about a prospect gathered from multiple sources, synthesize it into a structured profile.

Return a JSON object with exactly these fields:
- roleContext (string): A 1-2 sentence summary of the person's current role and responsibilities
- topicsOfInterest (string[]): Topics they care about professionally
- currentChallenges (string[]): Challenges they or their company face
- recentActivity (object[]): Each with "summary" (string), "source" (string), "timestamp" (ISO string)
- companyContext (string): A 1-2 sentence summary of their company's situation
- potentialPainPoints (string[]): Pain points relevant to B2B outreach
- publishedContentSummaries (string[]): Summaries of content they've published or been featured in

Return ONLY valid JSON, no markdown fences or extra text.`;

/**
 * Synthesize raw research data from multiple sources into a structured
 * profile using OpenAI. Aggregates all partial data and produces a
 * coherent, rich profile. Falls back to raw merged data on failure.
 */
export async function synthesizeResearchProfile(
  lead: Lead,
  rawResults: { adapterName: string; data: PartialResearchData }[],
): Promise<SynthesizedProfile> {
  if (rawResults.length === 0) {
    return buildFallbackSynthesizedProfile(lead, rawResults);
  }

  const aggregatedText = aggregateRawResults(lead, rawResults);

  try {
    const client = getOpenAIClient();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SYNTHESIS_TIMEOUT_MS);

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await client.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYNTHESIS_PROMPT },
            { role: 'user', content: aggregatedText },
          ],
          temperature: 0.2,
          max_tokens: 2048,
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      console.warn('[ProspectResearcher] Empty synthesis response from OpenAI, using fallback');
      return buildFallbackSynthesizedProfile(lead, rawResults);
    }

    // Strip markdown fences if present
    const jsonStr = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    // Validate and extract fields with safe defaults
    const synthesized: SynthesizedProfile = {
      roleContext:
        typeof parsed.roleContext === 'string'
          ? parsed.roleContext
          : `${lead.role} at ${lead.company}`,
      topicsOfInterest: Array.isArray(parsed.topicsOfInterest)
        ? (parsed.topicsOfInterest as unknown[]).filter((t): t is string => typeof t === 'string')
        : [],
      currentChallenges: Array.isArray(parsed.currentChallenges)
        ? (parsed.currentChallenges as unknown[]).filter((t): t is string => typeof t === 'string')
        : [],
      recentActivity: Array.isArray(parsed.recentActivity)
        ? (parsed.recentActivity as Record<string, unknown>[])
            .filter((a) => typeof a?.summary === 'string')
            .map((a) => ({
              summary: a.summary as string,
              source: typeof a.source === 'string' ? a.source : 'synthesis',
              timestamp: typeof a.timestamp === 'string' ? new Date(a.timestamp) : new Date(),
            }))
        : [],
      companyContext:
        typeof parsed.companyContext === 'string' ? parsed.companyContext : lead.company,
      potentialPainPoints: Array.isArray(parsed.potentialPainPoints)
        ? (parsed.potentialPainPoints as unknown[]).filter(
            (t): t is string => typeof t === 'string',
          )
        : [],
      publishedContentSummaries: Array.isArray(parsed.publishedContentSummaries)
        ? (parsed.publishedContentSummaries as unknown[]).filter(
            (t): t is string => typeof t === 'string',
          )
        : [],
    };

    return synthesized;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ProspectResearcher] Synthesis failed (${message}), using fallback`);
    return buildFallbackSynthesizedProfile(lead, rawResults);
  }
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

  // Synthesize raw data into a richer profile using OpenAI
  if (successfulResults.length > 0) {
    try {
      const synthesized = await synthesizeResearchProfile(lead, successfulResults);
      // Merge synthesized data into the profile, preferring synthesized fields when non-empty
      if (synthesized.topicsOfInterest.length > 0) {
        profile.topicsOfInterest = dedup([
          ...synthesized.topicsOfInterest,
          ...profile.topicsOfInterest,
        ]);
      }
      if (synthesized.currentChallenges.length > 0) {
        profile.currentChallenges = dedup([
          ...synthesized.currentChallenges,
          ...profile.currentChallenges,
        ]);
      }
      if (synthesized.recentActivity.length > 0) {
        profile.recentActivity = [...synthesized.recentActivity, ...profile.recentActivity];
      }
      if (synthesized.publishedContentSummaries.length > 0) {
        profile.publishedContentSummaries = dedup([
          ...synthesized.publishedContentSummaries,
          ...profile.publishedContentSummaries,
        ]);
      }
    } catch (error) {
      console.warn(
        `[ProspectResearcher] Synthesis integration failed for "${lead.name}":`,
        error instanceof Error ? error.message : String(error),
      );
      // Continue with raw merged profile
    }
  }

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

// ---------------------------------------------------------------------------
// Company Lookup for Prospects (Research Agent Fallback)
// ---------------------------------------------------------------------------

/** Timeout for the company lookup operation (30 seconds) */
const COMPANY_LOOKUP_TIMEOUT_MS = 30_000;

/**
 * Patterns used to extract a company name from a search snippet.
 * Each regex captures the company name in group 1.
 */
const SNIPPET_COMPANY_PATTERNS: RegExp[] = [
  /(?:CEO|CTO|CFO|COO|CMO|VP|Director|Head|Manager|Founder|Co-Founder|President)\s+(?:of|at)\s+([A-Z][A-Za-z0-9 &.,'-]+)/i,
  /(?:works?\s+at|employed\s+(?:at|by)|joined)\s+([A-Z][A-Za-z0-9 &.,'-]+)/i,
  /([A-Z][A-Za-z0-9 &.,'-]+)\s*[-\u2013\u2014|·]\s*(?:CEO|CTO|CFO|COO|CMO|VP|Director|Head|Manager|Founder|Co-Founder|President)/i,
  /(?:at|@)\s+([A-Z][A-Za-z0-9 &.,'-]+)/i,
];

/**
 * Try to extract a company name from a search snippet using heuristic patterns.
 */
function extractCompanyFromSnippet(snippet: string): string | null {
  for (const pattern of SNIPPET_COMPANY_PATTERNS) {
    const match = pattern.exec(snippet);
    if (match?.[1]) {
      const company = match[1]
        .trim()
        .replace(/[.,]+$/, '')
        .trim();
      if (company.length >= 2 && company.length <= 100) {
        return company;
      }
    }
  }
  return null;
}

/**
 * Lightweight company lookup for a prospect — used as a fallback when the
 * enrichment pipeline has no company name for a lead.
 *
 * 1. Builds a search query from the prospect name + available context fields
 * 2. Calls Serper API for web search results
 * 3. For the top 3 results, tries to fetch page content and summarize to find company
 * 4. Falls back to snippet-based extraction if content extraction fails
 * 5. Enforces a 30-second timeout
 */
export async function lookupCompanyForProspect(
  prospectName: string,
  context: {
    role?: string;
    linkedinUrl?: string;
    twitterHandle?: string;
    location?: string;
  },
): Promise<{ company: string | null; source: string }> {
  return withTimeout(
    lookupCompanyForProspectInner(prospectName, context),
    COMPANY_LOOKUP_TIMEOUT_MS,
    'lookupCompanyForProspect',
  );
}

async function lookupCompanyForProspectInner(
  prospectName: string,
  context: {
    role?: string;
    linkedinUrl?: string;
    twitterHandle?: string;
    location?: string;
  },
): Promise<{ company: string | null; source: string }> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn('[ProspectResearcher] SERPER_API_KEY not set, cannot lookup company');
    return { company: null, source: 'no_api_key' };
  }

  // Build search query from prospect name + available context
  const queryParts = [prospectName];
  if (context.role) queryParts.push(context.role);
  if (context.location) queryParts.push(context.location);
  if (context.twitterHandle) queryParts.push(context.twitterHandle.replace(/^@/, ''));
  queryParts.push('company');
  const searchQuery = queryParts.join(' ');

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: searchQuery, num: 5 }),
    });

    if (!response.ok) {
      console.warn(`[ProspectResearcher] Serper search failed with status ${response.status}`);
      return { company: null, source: 'serper_error' };
    }

    const data = (await response.json()) as {
      organic?: { title: string; snippet: string; link: string }[];
    };
    const results = data.organic ?? [];
    const top3 = results.slice(0, 3);

    if (top3.length === 0) {
      return { company: null, source: 'no_results' };
    }

    // Attempt content extraction + summarization for each of the top 3 results
    for (const result of top3) {
      try {
        const text = await fetchAndExtract(result.link);
        if (text) {
          const summary = await summarizeContent(text, result.link);
          if (summary) {
            // Look for company name in the synopsis or key points
            const companyFromSummary = extractCompanyFromSummary(summary, prospectName);
            if (companyFromSummary) {
              return { company: companyFromSummary, source: 'content_extraction' };
            }
          }
        }
      } catch {
        // Content extraction failed for this result — continue to next
      }
    }

    // Fallback: try to extract company from search snippets
    for (const result of top3) {
      const snippetText = `${result.title} ${result.snippet}`;
      const company = extractCompanyFromSnippet(snippetText);
      if (company) {
        return { company, source: 'snippet_extraction' };
      }
    }

    return { company: null, source: 'extraction_failed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ProspectResearcher] Company lookup failed: ${message}`);
    return { company: null, source: 'error' };
  }
}

/**
 * Extract a company name from a ContentSummary by looking at the synopsis
 * and key points for company-related patterns.
 */
function extractCompanyFromSummary(
  summary: { synopsis: string; keyPoints: string[] },
  prospectName: string,
): string | null {
  // Combine synopsis and key points into a single text block
  const combinedText = [summary.synopsis, ...summary.keyPoints].join(' ');

  // First try the snippet patterns on the combined text
  const fromPatterns = extractCompanyFromSnippet(combinedText);
  if (fromPatterns) return fromPatterns;

  // Try to find "{prospectName} ... at/of {Company}" in the text
  const firstName = prospectName.split(/\s+/)[0];
  if (firstName) {
    const nameCompanyPattern = new RegExp(
      `${escapeRegex(firstName)}[^.]*?(?:at|of|with|for)\\s+([A-Z][A-Za-z0-9 &.,'-]+)`,
      'i',
    );
    const match = nameCompanyPattern.exec(combinedText);
    if (match?.[1]) {
      const company = match[1]
        .trim()
        .replace(/[.,]+$/, '')
        .trim();
      if (company.length >= 2 && company.length <= 100) {
        return company;
      }
    }
  }

  return null;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Direct Email Web Search (Research Agent Fallback)
// ---------------------------------------------------------------------------

/** Timeout for the email search operation (30 seconds) */
const EMAIL_SEARCH_TIMEOUT_MS = 30_000;

/** Standard email regex for extracting candidates from text */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Search the web for a prospect's email address using Serper API,
 * extract email candidates from snippets, and validate via MX records.
 *
 * Queries: "{name} email", "{name} {company} contact", "{name} {company} email address"
 * Enforces a 30-second timeout.
 */
export async function searchEmailForProspect(
  prospectName: string,
  company: string,
): Promise<{ email: string | null; source: string }> {
  return withTimeout(
    searchEmailForProspectInner(prospectName, company),
    EMAIL_SEARCH_TIMEOUT_MS,
    'searchEmailForProspect',
  );
}

async function searchEmailForProspectInner(
  prospectName: string,
  company: string,
): Promise<{ email: string | null; source: string }> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn('[ProspectResearcher] SERPER_API_KEY not set, cannot search for email');
    return { email: null, source: 'no_api_key' };
  }

  // Build the 3 search queries
  const queries = [
    `"${prospectName}" email`,
    `"${prospectName}" ${company} contact`,
    `"${prospectName}" ${company} email address`,
  ];

  // Collect all email candidates from all queries
  const candidates: string[] = [];

  for (const searchQuery of queries) {
    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: searchQuery, num: 5 }),
      });

      if (!response.ok) {
        console.warn(
          `[ProspectResearcher] Serper email search failed with status ${response.status} for query: ${searchQuery}`,
        );
        continue;
      }

      const data = (await response.json()) as {
        organic?: { title: string; snippet: string; link: string }[];
      };
      const results = data.organic ?? [];

      // Extract email candidates from snippets
      for (const result of results) {
        const text = `${result.title} ${result.snippet}`;
        const matches = text.match(EMAIL_REGEX);
        if (matches) {
          for (const email of matches) {
            if (!candidates.includes(email)) {
              candidates.push(email);
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ProspectResearcher] Email search query failed: ${message} for query: ${searchQuery}`,
      );
    }
  }

  if (candidates.length === 0) {
    return { email: null, source: 'no_candidates' };
  }

  // Validate each candidate by checking MX records
  for (const candidate of candidates) {
    const domain = candidate.split('@')[1];
    if (!domain) continue;

    try {
      const mxRecords = await dnsPromises.resolveMx(domain);
      const hasMX = mxRecords && mxRecords.length > 0;
      if (hasMX) {
        return { email: candidate, source: 'research_agent_web_search' };
      }
    } catch {
      // MX lookup failed for this domain — skip candidate
    }
  }

  return { email: null, source: 'no_valid_mx' };
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
