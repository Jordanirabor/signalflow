// ============================================================
// GitHub Scraper — Source Adapter for Discovery & Enrichment
// Uses the GitHub REST API (https://api.github.com) instead of
// browser scraping to avoid CAPTCHA / proxy issues.
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

const RATE_LIMIT_SOURCE = 'github';
const GITHUB_API_BASE = 'https://api.github.com';
const USER_AGENT = 'SignalFlow-GTM-Engine/1.0';

/** Technical role keywords that trigger GitHub discovery */
const TECHNICAL_ROLE_KEYWORDS = ['engineer', 'cto', 'developer', 'architect', 'technical'];

// ---------------------------------------------------------------------------
// Exported Helpers (for testing)
// ---------------------------------------------------------------------------

/**
 * Returns true iff both display name and company affiliation are non-empty.
 * Exported for property-based testing (Property 7).
 */
export function isProfileComplete(profile: { displayName: string; company: string }): boolean {
  return profile.displayName.trim().length > 0 && profile.company.trim().length > 0;
}

/**
 * Check whether the ICP targets a technical role that warrants GitHub discovery.
 */
export function isTechnicalRole(targetRole: string): boolean {
  const lower = targetRole.toLowerCase();
  return TECHNICAL_ROLE_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// GitHub API Helpers
// ---------------------------------------------------------------------------

/**
 * Build common headers for GitHub REST API requests.
 * Includes a proper User-Agent and optional Bearer token for higher rate limits.
 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/** Shape returned by the GitHub user search endpoint. */
interface GitHubSearchUsersResponse {
  total_count: number;
  incomplete_results: boolean;
  items: { login: string }[];
}

/** Shape returned by the GitHub /users/{username} endpoint. */
interface GitHubUserResponse {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  public_repos: number;
  blog: string | null;
}

/**
 * Perform a GitHub user search via the REST API.
 * Docs: https://docs.github.com/en/rest/search/search#search-users
 */
async function searchUsers(query: string): Promise<string[]> {
  const url = `${GITHUB_API_BASE}/search/users?q=${encodeURIComponent(query)}&per_page=30`;
  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    console.warn(`[GitHubScraper] Search API returned ${res.status} for query "${query}"`);
    return [];
  }

  const data = (await res.json()) as GitHubSearchUsersResponse;
  return data.items.map((item) => item.login);
}

/**
 * Fetch a single user profile via the REST API.
 * Docs: https://docs.github.com/en/rest/users/users#get-a-user
 */
async function fetchUserProfile(username: string): Promise<GitHubUserResponse | null> {
  const url = `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}`;
  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    console.warn(`[GitHubScraper] User API returned ${res.status} for "${username}"`);
    return null;
  }

  return (await res.json()) as GitHubUserResponse;
}

// ---------------------------------------------------------------------------
// Profile to Lead Mapping
// ---------------------------------------------------------------------------

/**
 * Map a GitHub API user profile to a DiscoveredLeadData object.
 * Returns null if the profile is incomplete (missing name or company).
 */
function profileToLead(profile: GitHubUserResponse, icp: ICP): DiscoveredLeadData | null {
  const displayName = profile.name ?? '';
  const company = profile.company ?? '';

  if (!isProfileComplete({ displayName, company })) {
    console.log(
      `[GitHubScraper] Skipping incomplete profile "${profile.login}": ` +
        `name="${displayName}", company="${company}"`,
    );
    return null;
  }

  // Infer role from bio, falling back to ICP target role
  const role = inferRoleFromBio(profile.bio ?? '') || icp.targetRole;

  return {
    name: displayName,
    role,
    company: company.replace(/^@/, ''), // Remove leading @ from GitHub company names
    industry: icp.industry,
    geography: profile.location || icp.geography,
    discoverySource: 'github_scrape',
    githubUsername: profile.login,
  };
}

/**
 * Attempt to infer a role from a GitHub bio string.
 */
function inferRoleFromBio(bio: string): string | null {
  if (!bio) return null;
  const lower = bio.toLowerCase();

  const rolePatterns: { pattern: RegExp; role: string }[] = [
    { pattern: /\bcto\b/i, role: 'CTO' },
    { pattern: /\bchief technology officer\b/i, role: 'CTO' },
    { pattern: /\bvp\s+(?:of\s+)?engineering\b/i, role: 'VP Engineering' },
    { pattern: /\bhead\s+of\s+engineering\b/i, role: 'Head of Engineering' },
    { pattern: /\bstaff\s+engineer\b/i, role: 'Staff Engineer' },
    { pattern: /\bprincipal\s+engineer\b/i, role: 'Principal Engineer' },
    { pattern: /\bsoftware\s+architect\b/i, role: 'Software Architect' },
    { pattern: /\bsolutions?\s+architect\b/i, role: 'Solutions Architect' },
    { pattern: /\btechnical\s+lead\b/i, role: 'Technical Lead' },
    { pattern: /\btech\s+lead\b/i, role: 'Technical Lead' },
    { pattern: /\bengineering\s+manager\b/i, role: 'Engineering Manager' },
    { pattern: /\bsenior\s+(?:software\s+)?engineer\b/i, role: 'Senior Software Engineer' },
    { pattern: /\bsoftware\s+engineer\b/i, role: 'Software Engineer' },
    { pattern: /\bdeveloper\b/i, role: 'Developer' },
    { pattern: /\bfull[- ]?stack\b/i, role: 'Full Stack Developer' },
    { pattern: /\bbackend\b/i, role: 'Backend Developer' },
    { pattern: /\bfrontend\b/i, role: 'Frontend Developer' },
  ];

  for (const { pattern, role } of rolePatterns) {
    if (pattern.test(lower)) {
      return role;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// GitHub Scraper — Source Adapter
// ---------------------------------------------------------------------------

export const githubScraper: SourceAdapter = {
  name: 'github_scrape',
  capabilities: ['discovery', 'enrichment'],

  isEnabled(): boolean {
    const envVal = process.env.GITHUB_SCRAPING_ENABLED;
    // Default to true if not set — no longer needs proxies
    return envVal === undefined || envVal === '' || envVal.toLowerCase() === 'true';
  },

  async discover(queries: AnnotatedQuery[], icp: ICP): Promise<DiscoveredLeadData[]> {
    if (!this.isEnabled()) {
      console.log('[GitHubScraper] Adapter is disabled, skipping discovery');
      return [];
    }

    // Only activate for technical roles
    if (!isTechnicalRole(icp.targetRole)) {
      console.log(
        `[GitHubScraper] Target role "${icp.targetRole}" is not technical, skipping GitHub discovery`,
      );
      return [];
    }

    const githubQueries = queries.filter((q) => q.vector === 'github');
    if (githubQueries.length === 0) {
      console.log('[GitHubScraper] No GitHub-targeted queries, skipping');
      return [];
    }

    const allLeads: DiscoveredLeadData[] = [];
    const seenUsernames = new Set<string>();

    for (const annotatedQuery of githubQueries) {
      try {
        await acquirePermit(RATE_LIMIT_SOURCE);

        const usernames = await searchUsers(annotatedQuery.query);
        recordRequest(RATE_LIMIT_SOURCE);

        // Fetch each user's profile
        for (const username of usernames) {
          if (seenUsernames.has(username)) continue;
          seenUsernames.add(username);

          try {
            await acquirePermit(RATE_LIMIT_SOURCE);

            const profile = await fetchUserProfile(username);
            recordRequest(RATE_LIMIT_SOURCE);

            if (!profile) continue;

            const lead = profileToLead(profile, icp);
            if (lead) {
              allLeads.push(lead);
            }
          } catch (error) {
            console.error(
              `[GitHubScraper] Error processing profile ${username}:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      } catch (error) {
        console.error(
          `[GitHubScraper] Error executing query "${annotatedQuery.query}":`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    console.log(
      `[GitHubScraper] Discovery complete: ${allLeads.length} leads from ${githubQueries.length} queries`,
    );

    return allLeads;
  },

  async enrich(prospect: ProspectContext): Promise<Partial<ExtendedEnrichmentData>> {
    if (!this.isEnabled()) {
      console.log('[GitHubScraper] Adapter is disabled, skipping enrichment');
      return {};
    }

    if (!prospect.githubUsername) {
      console.log('[GitHubScraper] No GitHub username for prospect, skipping enrichment');
      return {};
    }

    try {
      await acquirePermit(RATE_LIMIT_SOURCE);

      const profile = await fetchUserProfile(prospect.githubUsername);
      recordRequest(RATE_LIMIT_SOURCE);

      if (!profile) return {};

      const result: Partial<ExtendedEnrichmentData> = {};

      // Build a bio-like string from GitHub data
      const bioParts: string[] = [];
      if (profile.bio) bioParts.push(profile.bio);
      if (profile.company) bioParts.push(`Works at ${profile.company}`);
      if (profile.location) bioParts.push(`Based in ${profile.location}`);
      if (profile.public_repos > 0) bioParts.push(`${profile.public_repos} public repos`);

      if (bioParts.length > 0) {
        result.companyInfo = bioParts.join('. ') + '.';
      }

      // Extract public email from the user profile
      if (profile.email) {
        result.email = profile.email;
        result.emailVerificationMethod = 'github_commit';
      }

      result.dataSources = ['github_scrape'];

      return result;
    } catch (error) {
      console.error(
        `[GitHubScraper] Enrichment error for ${prospect.githubUsername}:`,
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  },
};
