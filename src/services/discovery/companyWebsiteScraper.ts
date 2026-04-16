// ============================================================
// Company Website Scraper — Source Adapter for Enrichment
// Uses plain fetch to download HTML and extract team members,
// tech stack mentions, company description, and email patterns.
// ============================================================

import type { ExtendedEnrichmentData, ProspectContext, SourceAdapter } from './types';

import { acquirePermit, recordRequest } from './rateLimiter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_SOURCE = 'company_website';
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

const USER_AGENT = 'Mozilla/5.0 (compatible; SignalFlowBot/1.0; +https://signalflow.dev/bot)';

/** Subpages to scan for team/about content */
const SUBPAGE_PATHS = ['/about', '/team'];

/** Common tech stack keywords to detect */
const TECH_KEYWORDS = [
  'react',
  'angular',
  'vue',
  'next.js',
  'nextjs',
  'nuxt',
  'svelte',
  'node.js',
  'nodejs',
  'express',
  'django',
  'flask',
  'rails',
  'ruby on rails',
  'spring',
  'spring boot',
  'laravel',
  'php',
  '.net',
  'asp.net',
  'python',
  'java',
  'golang',
  'go',
  'rust',
  'typescript',
  'javascript',
  'kotlin',
  'swift',
  'scala',
  'elixir',
  'haskell',
  'clojure',
  'aws',
  'azure',
  'gcp',
  'google cloud',
  'docker',
  'kubernetes',
  'k8s',
  'terraform',
  'ansible',
  'jenkins',
  'circleci',
  'github actions',
  'postgresql',
  'postgres',
  'mysql',
  'mongodb',
  'redis',
  'elasticsearch',
  'graphql',
  'rest api',
  'grpc',
  'kafka',
  'rabbitmq',
  'machine learning',
  'ai',
  'deep learning',
  'tensorflow',
  'pytorch',
  'tailwind',
  'sass',
  'webpack',
  'vite',
  'remix',
];

// ---------------------------------------------------------------------------
// Extracted Data Types
// ---------------------------------------------------------------------------

export interface CompanyWebsiteData {
  description: string;
  teamMembers: { name: string; role: string }[];
  techStack: string[];
  emailPatterns: string[];
}

// ---------------------------------------------------------------------------
// Exported Helper Functions
// ---------------------------------------------------------------------------

/**
 * Extract email addresses from text content.
 * Matches standard email patterns and returns unique results.
 */
export function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) ?? [];
  return [...new Set(matches.map((e) => e.toLowerCase()))];
}

/**
 * Detect tech stack keywords in text content.
 * Returns unique matched keywords (lowercased).
 */
export function detectTechStack(text: string): string[] {
  const lowerText = text.toLowerCase();
  const found: string[] = [];

  for (const keyword of TECH_KEYWORDS) {
    if (keyword.length <= 3) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(lowerText)) {
        found.push(keyword);
      }
    } else if (lowerText.includes(keyword)) {
      found.push(keyword);
    }
  }

  return [...new Set(found)];
}

/**
 * Format extracted company data into a structured summary string
 * for the `companyInfo` enrichment field.
 */
export function formatCompanyInfo(data: CompanyWebsiteData): string {
  const parts: string[] = [];

  if (data.description.trim()) {
    parts.push(`Description: ${data.description.trim()}`);
  }

  if (data.teamMembers.length > 0) {
    const memberLines = data.teamMembers
      .slice(0, 10)
      .map((m) => `  - ${m.name}${m.role ? ` (${m.role})` : ''}`);
    parts.push(`Team Members:\n${memberLines.join('\n')}`);
  }

  if (data.techStack.length > 0) {
    parts.push(`Tech Stack: ${data.techStack.join(', ')}`);
  }

  return parts.join('\n\n');
}

/**
 * Extract the domain from a URL string.
 * Returns empty string if the URL is invalid.
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Internal HTML Extraction Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and return the HTML body as a string.
 * Returns empty string on any error (timeout, network, non-2xx).
 */
async function fetchHtml(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timer);

    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Extract description from HTML meta tags using regex.
 */
function extractDescriptionFromHtml(html: string): string {
  // Try meta description
  const metaDescMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  );
  const metaDesc = metaDescMatch?.[1] ?? '';

  // Also try content before name (attribute order varies)
  const metaDescAlt = html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  );
  const metaDescFallback = metaDescAlt?.[1] ?? '';

  // Try OG description
  const ogDescMatch = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  );
  const ogDesc = ogDescMatch?.[1] ?? '';

  const ogDescAlt = html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
  );
  const ogDescFallback = ogDescAlt?.[1] ?? '';

  // Pick the best one (longest meaningful description)
  const candidates = [metaDesc, metaDescFallback, ogDesc, ogDescFallback].filter(
    (d) => d.length > 0,
  );
  candidates.sort((a, b) => b.length - a.length);

  return candidates[0] ?? '';
}

/**
 * Strip HTML tags from a string to get plain text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract team members from HTML using JSON-LD structured data.
 */
function extractTeamMembersFromHtml(html: string): { name: string; role: string }[] {
  const members: { name: string; role: string }[] = [];

  // Try JSON-LD structured data
  const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const people = Array.isArray(data) ? data : (data.member ?? data.employee ?? []);
      for (const person of people) {
        if (person.name && typeof person.name === 'string') {
          members.push({
            name: person.name,
            role: (person.jobTitle ?? person.roleName ?? '') as string,
          });
        }
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  return members;
}

// ---------------------------------------------------------------------------
// Company Website Scraper — Source Adapter
// ---------------------------------------------------------------------------

export const companyWebsiteScraper: SourceAdapter = {
  name: 'company_website_scrape',
  capabilities: ['enrichment'],

  isEnabled(): boolean {
    return true;
  },

  async enrich(prospect: ProspectContext): Promise<Partial<ExtendedEnrichmentData>> {
    const websiteUrl = prospect.companyDomain;
    if (!websiteUrl) {
      console.log(
        `[CompanyWebsiteScraper] No company domain for prospect "${prospect.name}", skipping`,
      );
      return {};
    }

    const domain = extractDomain(websiteUrl);
    if (!domain) {
      console.log(
        `[CompanyWebsiteScraper] Invalid company domain "${websiteUrl}" for prospect "${prospect.name}", skipping`,
      );
      return {};
    }

    const baseUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

    try {
      await acquirePermit(RATE_LIMIT_SOURCE);

      const collectedData: CompanyWebsiteData = {
        description: '',
        teamMembers: [],
        techStack: [],
        emailPatterns: [],
      };

      // --- Fetch the homepage ---
      const homeHtml = await fetchHtml(baseUrl);
      recordRequest(RATE_LIMIT_SOURCE);

      if (homeHtml) {
        collectedData.description = extractDescriptionFromHtml(homeHtml);
        const homeText = stripHtml(homeHtml);
        collectedData.techStack.push(...detectTechStack(homeText));
        collectedData.emailPatterns.push(...extractEmails(homeText));
        collectedData.teamMembers.push(...extractTeamMembersFromHtml(homeHtml));
      }

      // --- Fetch about/team subpages ---
      for (const subpath of SUBPAGE_PATHS) {
        try {
          await acquirePermit(RATE_LIMIT_SOURCE);

          const subUrl = new URL(subpath, baseUrl).href;
          const subHtml = await fetchHtml(subUrl);
          recordRequest(RATE_LIMIT_SOURCE);

          if (!subHtml) continue;

          // Extract team members if we haven't found any yet
          if (collectedData.teamMembers.length === 0) {
            collectedData.teamMembers.push(...extractTeamMembersFromHtml(subHtml));
          }

          // Extract description if we don't have a good one yet
          if (collectedData.description.length < 50) {
            const desc = extractDescriptionFromHtml(subHtml);
            if (desc.length > collectedData.description.length) {
              collectedData.description = desc;
            }
          }

          // Scan for tech stack and emails
          const subText = stripHtml(subHtml);
          collectedData.techStack.push(...detectTechStack(subText));
          collectedData.emailPatterns.push(...extractEmails(subText));
        } catch {
          // Subpage error — continue silently
        }
      }

      // Deduplicate
      collectedData.techStack = [...new Set(collectedData.techStack)];
      collectedData.emailPatterns = [...new Set(collectedData.emailPatterns)];

      // Build enrichment result
      const companyInfo = formatCompanyInfo(collectedData);

      const result: Partial<ExtendedEnrichmentData> = {
        companyInfo: companyInfo || undefined,
        companyDomain: domain,
        dataSources: ['company_website_scrape'],
      };

      console.log(
        `[CompanyWebsiteScraper] Enrichment complete for "${prospect.company}": ` +
          `description=${collectedData.description.length > 0 ? 'yes' : 'no'}, ` +
          `teamMembers=${collectedData.teamMembers.length}, ` +
          `techStack=${collectedData.techStack.length}, ` +
          `emails=${collectedData.emailPatterns.length}`,
      );

      return result;
    } catch (error) {
      console.error(
        `[CompanyWebsiteScraper] Error scraping "${baseUrl}" for "${prospect.company}":`,
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  },
};
