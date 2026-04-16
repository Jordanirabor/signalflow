// ============================================================
// Twitter/X Discovery — Source Adapter (Serper.dev Google Search)
// Uses Google search via Serper.dev API instead of direct scraping.
// Twitter/X has aggressive bot detection and login walls, making
// direct scraping unreliable. Google indexes public profiles and
// bios, so we search "site:x.com" to find and enrich prospects.
// ============================================================

import type {
  AnnotatedQuery,
  DiscoveredLeadData,
  ExtendedEnrichmentData,
  ICP,
  ProspectContext,
  SourceAdapter,
} from './types';

import { acquirePermit, recordRequest } from './rateLimiter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_SOURCE = 'twitter';
const SERPER_API_URL = 'https://google.serper.dev/search';

// ---------------------------------------------------------------------------
// Exported Helpers (for testing)
// ---------------------------------------------------------------------------

/**
 * Infer role from a Twitter bio string.
 * Returns null if no recognizable role pattern is found.
 */
export function inferRoleFromBio(bio: string): string | null {
  if (!bio) return null;

  const rolePatterns: { pattern: RegExp; role: string }[] = [
    { pattern: /\bceo\b/i, role: 'CEO' },
    { pattern: /\bchief executive officer\b/i, role: 'CEO' },
    { pattern: /\bcto\b/i, role: 'CTO' },
    { pattern: /\bchief technology officer\b/i, role: 'CTO' },
    { pattern: /\bcmo\b/i, role: 'CMO' },
    { pattern: /\bchief marketing officer\b/i, role: 'CMO' },
    { pattern: /\bcfo\b/i, role: 'CFO' },
    { pattern: /\bchief financial officer\b/i, role: 'CFO' },
    { pattern: /\bcoo\b/i, role: 'COO' },
    { pattern: /\bchief operating officer\b/i, role: 'COO' },
    { pattern: /\bvp\s+(?:of\s+)?engineering\b/i, role: 'VP Engineering' },
    { pattern: /\bvp\s+(?:of\s+)?product\b/i, role: 'VP Product' },
    { pattern: /\bvp\s+(?:of\s+)?sales\b/i, role: 'VP Sales' },
    { pattern: /\bvp\s+(?:of\s+)?marketing\b/i, role: 'VP Marketing' },
    { pattern: /\bhead\s+of\s+engineering\b/i, role: 'Head of Engineering' },
    { pattern: /\bhead\s+of\s+product\b/i, role: 'Head of Product' },
    { pattern: /\bhead\s+of\s+growth\b/i, role: 'Head of Growth' },
    { pattern: /\bco-?founder\b/i, role: 'Co-Founder' },
    { pattern: /\bfounder\b/i, role: 'Founder' },
    { pattern: /\bdirector\s+of\s+engineering\b/i, role: 'Director of Engineering' },
    { pattern: /\bengineering\s+manager\b/i, role: 'Engineering Manager' },
    { pattern: /\bproduct\s+manager\b/i, role: 'Product Manager' },
    { pattern: /\bstaff\s+engineer\b/i, role: 'Staff Engineer' },
    { pattern: /\bprincipal\s+engineer\b/i, role: 'Principal Engineer' },
    { pattern: /\bsoftware\s+architect\b/i, role: 'Software Architect' },
    { pattern: /\btechnical\s+lead\b/i, role: 'Technical Lead' },
    { pattern: /\btech\s+lead\b/i, role: 'Technical Lead' },
    { pattern: /\bsenior\s+(?:software\s+)?engineer\b/i, role: 'Senior Software Engineer' },
    { pattern: /\bsoftware\s+engineer\b/i, role: 'Software Engineer' },
    { pattern: /\bdeveloper\b/i, role: 'Developer' },
    { pattern: /\bdesigner\b/i, role: 'Designer' },
    { pattern: /\bdata\s+scientist\b/i, role: 'Data Scientist' },
  ];

  for (const { pattern, role } of rolePatterns) {
    if (pattern.test(bio)) {
      return role;
    }
  }

  return null;
}

/**
 * Infer company name from a Twitter bio string.
 * Looks for common patterns like "@CompanyName", "at CompanyName", "Building CompanyName".
 */
export function inferCompanyFromBio(bio: string): string | null {
  if (!bio) return null;

  // Pattern: "at CompanyName" or "@ CompanyName"
  const atMatch = bio.match(/\b(?:at|@)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,2})/);
  if (atMatch?.[1]) return atMatch[1].trim();

  // Pattern: "Building CompanyName" or "building CompanyName"
  const buildingMatch = bio.match(
    /\b[Bb]uilding\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,2})/,
  );
  if (buildingMatch?.[1]) return buildingMatch[1].trim();

  // Pattern: "Founder of CompanyName" or "CEO of CompanyName"
  const ofMatch = bio.match(
    /\b(?:founder|ceo|cto|coo|cmo|cfo|director|head|vp)\s+(?:of|at)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,2})/i,
  );
  if (ofMatch?.[1]) return ofMatch[1].trim();

  return null;
}

/**
 * Infer industry from bio and tweet content.
 * Returns null if no recognizable industry is found.
 */
export function inferIndustryFromContent(bio: string, tweets: string[]): string | null {
  const combined = [bio, ...tweets].join(' ').toLowerCase();

  const industryPatterns: { pattern: RegExp; industry: string }[] = [
    { pattern: /\b(?:saas|software as a service)\b/, industry: 'SaaS' },
    { pattern: /\b(?:fintech|financial technology)\b/, industry: 'Fintech' },
    {
      pattern: /\b(?:healthtech|health tech|healthcare technology)\b/,
      industry: 'Healthcare Technology',
    },
    { pattern: /\b(?:edtech|education technology)\b/, industry: 'Education Technology' },
    {
      pattern: /\b(?:ai|artificial intelligence|machine learning|ml)\b/,
      industry: 'Artificial Intelligence',
    },
    { pattern: /\b(?:cybersecurity|infosec|information security)\b/, industry: 'Cybersecurity' },
    { pattern: /\b(?:blockchain|web3|crypto)\b/, industry: 'Blockchain' },
    { pattern: /\b(?:e-?commerce|online retail)\b/, industry: 'E-Commerce' },
    { pattern: /\b(?:devtools|developer tools)\b/, industry: 'Developer Tools' },
    { pattern: /\b(?:cloud computing|cloud infrastructure)\b/, industry: 'Cloud Computing' },
    { pattern: /\b(?:biotech|biotechnology)\b/, industry: 'Biotechnology' },
    { pattern: /\b(?:cleantech|clean energy|renewable)\b/, industry: 'Clean Technology' },
    { pattern: /\b(?:real estate|proptech)\b/, industry: 'Real Estate Technology' },
    { pattern: /\b(?:logistics|supply chain)\b/, industry: 'Logistics' },
    { pattern: /\b(?:gaming|game dev)\b/, industry: 'Gaming' },
    { pattern: /\b(?:media|content|publishing)\b/, industry: 'Media' },
    { pattern: /\b(?:marketing|adtech|advertising)\b/, industry: 'Marketing Technology' },
  ];

  for (const { pattern, industry } of industryPatterns) {
    if (pattern.test(combined)) {
      return industry;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Serper.dev API Types
// ---------------------------------------------------------------------------

interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperSearchResponse {
  organic?: SerperOrganicResult[];
  searchParameters?: { q: string };
}

// ---------------------------------------------------------------------------
// Serper.dev API Helper
// ---------------------------------------------------------------------------

/**
 * Execute a Google search via Serper.dev API.
 */
async function serperSearch(query: string): Promise<SerperOrganicResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn('[TwitterScraper] SERPER_API_KEY not set, cannot search');
    return [];
  }

  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 10 }),
  });

  if (!response.ok) {
    console.error(`[TwitterScraper] Serper API error: ${response.status} ${response.statusText}`);
    return [];
  }

  const data = (await response.json()) as SerperSearchResponse;
  return data.organic ?? [];
}

// ---------------------------------------------------------------------------
// Twitter Handle Extraction
// ---------------------------------------------------------------------------

/**
 * Extract a Twitter/X handle from a URL like https://x.com/handle or
 * https://twitter.com/handle. Returns null for non-profile URLs.
 */
function extractHandleFromUrl(url: string): string | null {
  const match = url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/);
  if (!match?.[1]) return null;

  // Filter out non-profile pages
  const reserved = new Set([
    'search',
    'explore',
    'home',
    'notifications',
    'messages',
    'settings',
    'i',
    'intent',
    'hashtag',
    'compose',
    'login',
    'signup',
  ]);
  const handle = match[1].toLowerCase();
  if (reserved.has(handle)) return null;

  return match[1];
}

// ---------------------------------------------------------------------------
// Search Result to Lead Mapping
// ---------------------------------------------------------------------------

/**
 * Map a Serper search result (from a site:x.com query) to a DiscoveredLeadData.
 * The Google snippet typically contains the user's bio text.
 * Returns null if we can't extract enough useful data.
 */
function searchResultToLead(result: SerperOrganicResult, icp: ICP): DiscoveredLeadData | null {
  const handle = extractHandleFromUrl(result.link);
  if (!handle) return null;

  // Use the title and snippet as raw context — AI will extract the real name later
  const title = result.title || '';
  const snippet = result.snippet || '';

  // Try to get display name from title pattern "Name (@handle) / X"
  let displayName = '';
  const handlePattern = new RegExp(`^(.+?)\\s*[\\(\\(@]${handle}`, 'i');
  const handleMatch = title.match(handlePattern);
  if (handleMatch) {
    displayName = handleMatch[1].trim();
  }
  if (!displayName) {
    const slashMatch = title.match(/^(.+?)\s*(?:\/|on)\s*X\b/i);
    if (slashMatch && slashMatch[1].trim().length <= 40) {
      displayName = slashMatch[1].trim();
    }
  }

  // Clean up
  displayName = (displayName || '').replace(/[\(\)\[\]|]+$/, '').trim();

  // If we couldn't get a name from the title, skip — AI batch will handle later
  if (!displayName || displayName.length > 50 || displayName.includes('...')) return null;

  const bio = snippet || '';
  const role = inferRoleFromBio(bio) || icp.targetRole;
  const company = inferCompanyFromBio(bio) || '';

  if (!company) {
    console.log(`[TwitterScraper] Profile without company (keeping): @${handle} (${displayName})`);
  }

  const industry = inferIndustryFromContent(bio, []) || icp.industry;

  return {
    name: displayName,
    role,
    company,
    industry,
    geography: icp.geography,
    discoverySource: 'twitter_scrape',
    twitterHandle: handle,
  };
}

/**
 * Use OpenAI to validate and clean up a batch of discovered leads.
 * Filters out non-person entries and extracts real names/companies from context.
 */
async function aiCleanupLeads(leads: DiscoveredLeadData[]): Promise<DiscoveredLeadData[]> {
  if (leads.length === 0) return [];
  if (!process.env.OPENAI_API_KEY) return leads; // No AI available, return as-is

  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI();

    const entries = leads
      .map(
        (l, i) =>
          `${i}. Name: "${l.name}", Handle: @${l.twitterHandle}, Role: "${l.role}", Company: "${l.company}"`,
      )
      .join('\n');

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a data quality filter. Given a list of potential leads scraped from Twitter/X search results, determine which entries are real people (not companies, bots, news accounts, or garbage data).

For each entry, respond with a JSON array of objects. Each object should have:
- "index": the original index number
- "isRealPerson": true/false
- "correctedName": the real person name if you can determine it (or null)
- "company": the company they work at if you can determine it (or empty string)

Only include entries where isRealPerson is true. Be strict — reject company accounts, news outlets, job postings, and nonsensical names.`,
        },
        {
          role: 'user',
          content: entries,
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? '[]';
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return leads;

    const parsed: Array<{
      index: number;
      isRealPerson: boolean;
      correctedName?: string | null;
      company?: string;
    }> = JSON.parse(jsonMatch[0]);

    const cleaned: DiscoveredLeadData[] = [];
    for (const entry of parsed) {
      if (!entry.isRealPerson) continue;
      const original = leads[entry.index];
      if (!original) continue;

      cleaned.push({
        ...original,
        name: entry.correctedName || original.name,
        company: entry.company || original.company,
      });
    }

    console.log(`[TwitterScraper] AI cleanup: ${leads.length} → ${cleaned.length} valid leads`);
    return cleaned;
  } catch (err) {
    console.error(
      '[TwitterScraper] AI cleanup failed, returning raw leads:',
      err instanceof Error ? err.message : String(err),
    );
    return leads;
  }
}

// ---------------------------------------------------------------------------
// Twitter Scraper — Source Adapter (Serper.dev)
// ---------------------------------------------------------------------------

export const twitterScraper: SourceAdapter = {
  name: 'twitter_scrape',
  capabilities: ['discovery', 'enrichment'],

  isEnabled(): boolean {
    // Require SERPER_API_KEY to be set
    if (!process.env.SERPER_API_KEY) return false;

    // Respect TWITTER_SCRAPING_ENABLED (default true)
    const envVal = process.env.TWITTER_SCRAPING_ENABLED;
    return envVal === undefined || envVal === '' || envVal.toLowerCase() === 'true';
  },

  async discover(queries: AnnotatedQuery[], icp: ICP): Promise<DiscoveredLeadData[]> {
    if (!this.isEnabled()) {
      console.log('[TwitterScraper] Adapter is disabled, skipping discovery');
      return [];
    }

    const twitterQueries = queries.filter((q) => q.vector === 'twitter');
    if (twitterQueries.length === 0) {
      console.log('[TwitterScraper] No Twitter-targeted queries, skipping');
      return [];
    }

    const allLeads: DiscoveredLeadData[] = [];
    const seenHandles = new Set<string>();

    for (const annotatedQuery of twitterQueries) {
      try {
        await acquirePermit(RATE_LIMIT_SOURCE);

        // Wrap the original query with site:x.com to target Twitter profiles
        const siteQuery = `site:x.com ${annotatedQuery.query}`;
        const results = await serperSearch(siteQuery);
        recordRequest(RATE_LIMIT_SOURCE);

        for (const result of results) {
          const handle = extractHandleFromUrl(result.link);
          if (!handle) continue;

          const normalizedHandle = handle.toLowerCase();
          if (seenHandles.has(normalizedHandle)) continue;
          seenHandles.add(normalizedHandle);

          const lead = searchResultToLead(result, icp);
          if (lead) {
            allLeads.push(lead);
          }
        }
      } catch (error) {
        console.error(
          `[TwitterScraper] Error executing query "${annotatedQuery.query}":`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    console.log(
      `[TwitterScraper] Discovery complete: ${allLeads.length} leads from ${twitterQueries.length} queries`,
    );

    // Run AI cleanup to filter out non-person entries and correct names
    const cleaned = await aiCleanupLeads(allLeads);
    return cleaned;
  },

  async enrich(prospect: ProspectContext): Promise<Partial<ExtendedEnrichmentData>> {
    if (!this.isEnabled()) {
      console.log('[TwitterScraper] Adapter is disabled, skipping enrichment');
      return {};
    }

    if (!prospect.twitterHandle) {
      console.log('[TwitterScraper] No Twitter handle for prospect, skipping enrichment');
      return {};
    }

    try {
      await acquirePermit(RATE_LIMIT_SOURCE);

      // Search Google for the specific Twitter profile
      const query = `site:x.com ${prospect.twitterHandle} ${prospect.name}`;
      const results = await serperSearch(query);
      recordRequest(RATE_LIMIT_SOURCE);

      // Find the result that matches the prospect's handle
      const profileResult = results.find((r) => {
        const handle = extractHandleFromUrl(r.link);
        return handle?.toLowerCase() === prospect.twitterHandle?.toLowerCase();
      });

      if (!profileResult) {
        console.log(`[TwitterScraper] No Google result found for @${prospect.twitterHandle}`);
        return {};
      }

      const result: Partial<ExtendedEnrichmentData> = {};

      // The snippet typically contains the bio
      if (profileResult.snippet) {
        result.linkedinBio = profileResult.snippet;
      }

      result.dataSources = ['twitter_scrape'];

      return result;
    } catch (error) {
      console.error(
        `[TwitterScraper] Enrichment error for @${prospect.twitterHandle}:`,
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  },
};
