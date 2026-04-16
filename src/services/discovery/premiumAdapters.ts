// ============================================================
// Premium Adapters — Optional Paid API Source Adapters
// ============================================================
// Apollo.io (discovery), Hunter.io (email verification), Clearbit (company data)
// All default to disabled. System works identically without them.
// ============================================================

import type {
  AnnotatedQuery,
  DiscoveredLeadData,
  ExtendedEnrichmentData,
  ICP,
  ProspectContext,
  SourceAdapter,
} from './types';

// ---------------------------------------------------------------------------
// Apollo Adapter — Discovery capability
// ---------------------------------------------------------------------------

export const apolloAdapter: SourceAdapter = {
  name: 'apollo_api',
  capabilities: ['discovery'],

  isEnabled(): boolean {
    return (
      process.env.APOLLO_ENABLED?.toLowerCase() === 'true' &&
      typeof process.env.APOLLO_API_KEY === 'string' &&
      process.env.APOLLO_API_KEY.length > 0
    );
  },

  async discover(queries: AnnotatedQuery[], icp: ICP): Promise<DiscoveredLeadData[]> {
    if (!this.isEnabled()) {
      console.log('[ApolloAdapter] Adapter is disabled, skipping discovery');
      return [];
    }

    console.log(
      `[ApolloAdapter] Starting discovery for role="${icp.targetRole}", industry="${icp.industry}", geography="${icp.geography}"`,
    );

    const apiKey = process.env.APOLLO_API_KEY!;
    const leads: DiscoveredLeadData[] = [];

    try {
      const response = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify({
          person_titles: [icp.targetRole],
          person_locations: icp.geography ? [icp.geography] : undefined,
          q_organization_keyword_tags: icp.industry ? [icp.industry] : undefined,
          per_page: 25,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          `[ApolloAdapter] API request failed with status ${response.status}: ${response.statusText}. Body: ${errorBody.slice(0, 500)}`,
        );
        return [];
      }

      const data = (await response.json()) as {
        people?: Array<{
          id?: string;
          first_name?: string;
          last_name?: string;
          last_name_obfuscated?: string;
          title?: string;
          organization?: {
            name?: string;
            has_industry?: boolean;
          };
          linkedin_url?: string;
          twitter_url?: string;
          github_url?: string;
          city?: string;
          state?: string;
          country?: string;
          has_email?: boolean;
          has_city?: boolean;
          has_state?: boolean;
          has_country?: boolean;
        }>;
      };

      console.log(`[ApolloAdapter] API returned ${data.people?.length ?? 0} people`);

      for (const person of data.people ?? []) {
        // Free plan returns obfuscated last names like "Sm***h"
        const lastName = person.last_name ?? person.last_name_obfuscated ?? '';
        const name = [person.first_name, lastName].filter(Boolean).join(' ');
        if (!name || !person.organization?.name) continue;

        const geography = [person.city, person.state, person.country].filter(Boolean).join(', ');

        leads.push({
          name,
          role: person.title ?? icp.targetRole,
          company: person.organization.name,
          industry: icp.industry,
          geography: geography || icp.geography,
          discoverySource: 'apollo_api',
          linkedinUrl: person.linkedin_url,
          companyDomain: undefined,
          twitterHandle: person.twitter_url
            ? person.twitter_url.replace(/^https?:\/\/(www\.)?twitter\.com\//, '')
            : undefined,
          githubUsername: person.github_url
            ? person.github_url.replace(/^https?:\/\/(www\.)?github\.com\//, '')
            : undefined,
        });
      }

      console.log(`[ApolloAdapter] Discovery complete: ${leads.length} leads found`);
    } catch (error) {
      console.error(
        '[ApolloAdapter] Discovery failed:',
        error instanceof Error ? error.message : String(error),
      );
    }

    return leads;
  },
};

// ---------------------------------------------------------------------------
// Hunter Adapter — Enrichment capability (email verification)
// ---------------------------------------------------------------------------

export const hunterAdapter: SourceAdapter = {
  name: 'hunter_api',
  capabilities: ['enrichment'],

  isEnabled(): boolean {
    return (
      process.env.HUNTER_ENABLED?.toLowerCase() === 'true' &&
      typeof process.env.HUNTER_API_KEY === 'string' &&
      process.env.HUNTER_API_KEY.length > 0
    );
  },

  async enrich(prospect: ProspectContext): Promise<Partial<ExtendedEnrichmentData>> {
    if (!this.isEnabled()) {
      console.log('[HunterAdapter] Adapter is disabled, skipping enrichment');
      return {};
    }

    const apiKey = process.env.HUNTER_API_KEY!;

    try {
      const nameParts = prospect.name.split(' ');
      const firstName = nameParts[0] ?? '';
      const lastName = nameParts.slice(1).join(' ') ?? '';

      // Need a domain to look up email
      const domain = prospect.companyDomain;
      if (!domain) {
        console.log('[HunterAdapter] No company domain available, skipping email lookup');
        return {};
      }

      const params = new URLSearchParams({
        domain,
        first_name: firstName,
        last_name: lastName,
        api_key: apiKey,
      });

      const response = await fetch(`https://api.hunter.io/v2/email-finder?${params.toString()}`);

      if (!response.ok) {
        console.error(
          `[HunterAdapter] API request failed with status ${response.status}: ${response.statusText}`,
        );
        return {};
      }

      const data = (await response.json()) as {
        data?: {
          email?: string;
          score?: number;
          domain?: string;
          position?: string;
          linkedin_url?: string;
          verification?: {
            status?: string;
          };
        };
      };

      const result: Partial<ExtendedEnrichmentData> = {};

      if (data.data?.email) {
        result.email = data.data.email;
        result.emailVerified = data.data.verification?.status === 'valid';
        result.emailVerificationMethod = 'hunter_api';
        result.companyDomain = data.data.domain ?? domain;
      }

      if (data.data?.linkedin_url) {
        result.linkedinUrl = data.data.linkedin_url;
      }

      console.log(
        `[HunterAdapter] Enrichment complete: ${result.email ? 'email found' : 'no email found'}`,
      );

      return result;
    } catch (error) {
      console.error(
        '[HunterAdapter] Enrichment failed:',
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  },
};

// ---------------------------------------------------------------------------
// Clearbit Adapter — Enrichment capability (company data)
// ---------------------------------------------------------------------------

export const clearbitAdapter: SourceAdapter = {
  name: 'clearbit_api',
  capabilities: ['enrichment'],

  isEnabled(): boolean {
    return (
      process.env.CLEARBIT_ENABLED?.toLowerCase() === 'true' &&
      typeof process.env.CLEARBIT_API_KEY === 'string' &&
      process.env.CLEARBIT_API_KEY.length > 0
    );
  },

  async enrich(prospect: ProspectContext): Promise<Partial<ExtendedEnrichmentData>> {
    if (!this.isEnabled()) {
      console.log('[ClearbitAdapter] Adapter is disabled, skipping enrichment');
      return {};
    }

    const apiKey = process.env.CLEARBIT_API_KEY!;

    try {
      const domain = prospect.companyDomain;
      if (!domain) {
        console.log('[ClearbitAdapter] No company domain available, skipping company lookup');
        return {};
      }

      const response = await fetch(
        `https://company.clearbit.com/v2/companies/find?domain=${encodeURIComponent(domain)}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );

      if (!response.ok) {
        console.error(
          `[ClearbitAdapter] API request failed with status ${response.status}: ${response.statusText}`,
        );
        return {};
      }

      const data = (await response.json()) as {
        name?: string;
        description?: string;
        domain?: string;
        category?: { industry?: string; sector?: string };
        metrics?: { employees?: number; raised?: number };
        tech?: string[];
        linkedin?: { handle?: string };
        twitter?: { handle?: string };
        geo?: { city?: string; state?: string; country?: string };
      };

      const result: Partial<ExtendedEnrichmentData> = {};

      // Build a structured company info string
      const infoParts: string[] = [];
      if (data.name) infoParts.push(`Company: ${data.name}`);
      if (data.description) infoParts.push(`Description: ${data.description}`);
      if (data.category?.industry) infoParts.push(`Industry: ${data.category.industry}`);
      if (data.category?.sector) infoParts.push(`Sector: ${data.category.sector}`);
      if (data.metrics?.employees) infoParts.push(`Employees: ${data.metrics.employees}`);
      if (data.metrics?.raised) infoParts.push(`Funding raised: $${data.metrics.raised}`);
      if (data.tech?.length) infoParts.push(`Tech stack: ${data.tech.join(', ')}`);
      if (data.geo) {
        const location = [data.geo.city, data.geo.state, data.geo.country]
          .filter(Boolean)
          .join(', ');
        if (location) infoParts.push(`Location: ${location}`);
      }

      if (infoParts.length > 0) {
        result.companyInfo = infoParts.join(' | ');
      }

      result.companyDomain = data.domain ?? domain;

      if (data.linkedin?.handle) {
        result.linkedinUrl = `https://www.linkedin.com/company/${data.linkedin.handle}`;
      }

      console.log(
        `[ClearbitAdapter] Enrichment complete: ${infoParts.length} data fields collected`,
      );

      return result;
    } catch (error) {
      console.error(
        '[ClearbitAdapter] Enrichment failed:',
        error instanceof Error ? error.message : String(error),
      );
      return {};
    }
  },
};
