// ============================================================
// Directory Scraper — Source Adapter for Discovery
// Scrapes Crunchbase, AngelList/Wellfound, and Y Combinator
// ============================================================

import type { Page } from 'playwright';

import type { AnnotatedQuery, DiscoveredLeadData, ICP, SourceAdapter } from './types';

import { acquirePermit, recordRequest } from './rateLimiter';
import { closeBrowser, createPage, detectCaptcha, launchBrowser } from './scraperUtils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_SOURCE = 'directory';

// ---------------------------------------------------------------------------
// Role Synonym Map — maps short/common titles to expanded forms
// ---------------------------------------------------------------------------

const ROLE_SYNONYMS: Record<string, string[]> = {
  cto: ['chief technology officer', 'cto', 'chief tech officer'],
  ceo: ['chief executive officer', 'ceo', 'founder & ceo', 'co-founder & ceo'],
  cfo: ['chief financial officer', 'cfo'],
  coo: ['chief operating officer', 'coo'],
  cmo: ['chief marketing officer', 'cmo'],
  cpo: ['chief product officer', 'cpo'],
  cro: ['chief revenue officer', 'cro'],
  'vp engineering': [
    'vice president of engineering',
    'vp of engineering',
    'vp engineering',
    'vice president engineering',
  ],
  'vp product': [
    'vice president of product',
    'vp of product',
    'vp product',
    'vice president product',
  ],
  'vp sales': ['vice president of sales', 'vp of sales', 'vp sales', 'vice president sales'],
  'vp marketing': [
    'vice president of marketing',
    'vp of marketing',
    'vp marketing',
    'vice president marketing',
  ],
  engineer: ['software engineer', 'engineer', 'engineering', 'developer', 'software developer'],
  architect: ['software architect', 'architect', 'solutions architect', 'technical architect'],
  director: ['director of engineering', 'director of product', 'engineering director'],
  founder: ['founder', 'co-founder', 'cofounder'],
  'head of': ['head of engineering', 'head of product', 'head of growth', 'head of sales'],
};

// ---------------------------------------------------------------------------
// Exported Role Filter Helper
// ---------------------------------------------------------------------------

/**
 * Filter team members whose role matches or is semantically similar to the
 * target role. Uses case-insensitive substring matching and common role
 * synonym expansion.
 *
 * Exported for testing.
 */
export function filterByRole(
  members: { name: string; role: string }[],
  targetRole: string,
): { name: string; role: string }[] {
  if (!targetRole || targetRole.trim().length === 0) {
    return members;
  }

  const target = targetRole.toLowerCase().trim();

  // Build a set of all terms to match against
  const matchTerms = new Set<string>();
  matchTerms.add(target);

  // Add synonyms for the target role
  for (const [key, synonyms] of Object.entries(ROLE_SYNONYMS)) {
    const keyLower = key.toLowerCase();
    // If the target matches the synonym key or any synonym value, add all related terms
    if (target.includes(keyLower) || keyLower.includes(target)) {
      matchTerms.add(keyLower);
      for (const syn of synonyms) {
        matchTerms.add(syn.toLowerCase());
      }
    }
    // Also check if any synonym matches the target
    for (const syn of synonyms) {
      if (target.includes(syn.toLowerCase()) || syn.toLowerCase().includes(target)) {
        matchTerms.add(keyLower);
        for (const s of synonyms) {
          matchTerms.add(s.toLowerCase());
        }
        break;
      }
    }
  }

  return members.filter((member) => {
    if (!member.role) return false;
    const role = member.role.toLowerCase().trim();

    // Check if the member's role matches any of the expanded terms
    for (const term of matchTerms) {
      if (role.includes(term) || term.includes(role)) {
        return true;
      }
    }

    return false;
  });
}

// ---------------------------------------------------------------------------
// URL Pattern Detection
// ---------------------------------------------------------------------------

/**
 * Determine which directory a URL belongs to.
 */
export function identifyDirectory(url: string): 'crunchbase' | 'angellist' | 'yc' | null {
  const lower = url.toLowerCase();
  if (lower.includes('crunchbase.com/organization/') || lower.includes('crunchbase.com/person/')) {
    return 'crunchbase';
  }
  if (lower.includes('angel.co/') || lower.includes('wellfound.com/')) {
    return 'angellist';
  }
  if (lower.includes('ycombinator.com/companies/')) {
    return 'yc';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Crunchbase Extraction
// ---------------------------------------------------------------------------

interface CrunchbaseData {
  companyName: string;
  description: string;
  industry: string;
  employeeCount: string;
  fundingStage: string;
  teamMembers: { name: string; role: string }[];
}

async function extractCrunchbase(page: Page): Promise<CrunchbaseData> {
  return page.evaluate(() => {
    const getText = (selector: string): string =>
      document.querySelector(selector)?.textContent?.trim() ?? '';

    // Company name — try common Crunchbase selectors
    const companyName =
      getText('h1') || getText('[data-test="entity-name"]') || getText('.profile-name');

    // Description
    const description =
      getText('[data-test="description"]') ||
      getText('.description') ||
      getText('.entity-description');

    // Industry
    const industry = getText('[data-test="industry"]') || getText('.field-type-enum_multi a') || '';

    // Employee count
    const employeeCount =
      getText('[data-test="employee-count"]') || getText('.field-type-num_employees') || '';

    // Funding stage
    const fundingStage =
      getText('[data-test="funding-stage"]') || getText('.field-type-enum a') || '';

    // Team members
    const teamMembers: { name: string; role: string }[] = [];
    const personCards = document.querySelectorAll(
      '[data-test="person-card"], .people-card, .team-member, .person-card',
    );
    for (const card of personCards) {
      const name =
        card.querySelector('[data-test="person-name"], .person-name, h4, a')?.textContent?.trim() ??
        '';
      const role =
        card
          .querySelector('[data-test="person-title"], .person-title, .role, .title')
          ?.textContent?.trim() ?? '';
      if (name) {
        teamMembers.push({ name, role });
      }
    }

    return { companyName, description, industry, employeeCount, fundingStage, teamMembers };
  });
}

// ---------------------------------------------------------------------------
// AngelList / Wellfound Extraction
// ---------------------------------------------------------------------------

interface AngelListData {
  companyName: string;
  description: string;
  teamMembers: { name: string; role: string }[];
}

async function extractAngelList(page: Page): Promise<AngelListData> {
  return page.evaluate(() => {
    const getText = (selector: string): string =>
      document.querySelector(selector)?.textContent?.trim() ?? '';

    const companyName =
      getText('h1') || getText('[data-test="startup-name"]') || getText('.startup-name');

    const description =
      getText('[data-test="startup-description"]') ||
      getText('.product-description') ||
      getText('.js-startup_high_concept') ||
      '';

    const teamMembers: { name: string; role: string }[] = [];
    const memberEls = document.querySelectorAll(
      '.team-member, .founder-card, [data-test="team-member"], .people .person',
    );
    for (const el of memberEls) {
      const name =
        el.querySelector('.name, h4, a, [data-test="person-name"]')?.textContent?.trim() ?? '';
      const role =
        el.querySelector('.role, .title, [data-test="person-role"]')?.textContent?.trim() ?? '';
      if (name) {
        teamMembers.push({ name, role });
      }
    }

    return { companyName, description, teamMembers };
  });
}

// ---------------------------------------------------------------------------
// Y Combinator Extraction
// ---------------------------------------------------------------------------

interface YCData {
  companyName: string;
  batchYear: string;
  description: string;
  founders: { name: string; role: string }[];
}

async function extractYC(page: Page): Promise<YCData> {
  return page.evaluate(() => {
    const getText = (selector: string): string =>
      document.querySelector(selector)?.textContent?.trim() ?? '';

    const companyName = getText('h1') || getText('.company-name') || '';

    // Batch year — often in a badge or tag
    const batchYear = getText('.batch, .yc-batch, [data-test="batch"]') || getText('.pill') || '';

    const description =
      getText('.company-description') ||
      getText('[data-test="company-description"]') ||
      getText('.prose') ||
      '';

    const founders: { name: string; role: string }[] = [];
    const founderEls = document.querySelectorAll(
      '.founder, .team-member, [data-test="founder"], .founder-card',
    );
    for (const el of founderEls) {
      const name =
        el.querySelector('.name, h3, h4, a, [data-test="founder-name"]')?.textContent?.trim() ?? '';
      const role =
        el.querySelector('.role, .title, [data-test="founder-role"]')?.textContent?.trim() ||
        'Founder';
      if (name) {
        founders.push({ name, role });
      }
    }

    return { companyName, batchYear, description, founders };
  });
}

// ---------------------------------------------------------------------------
// Page Scraping Orchestrator
// ---------------------------------------------------------------------------

/**
 * Scrape a single directory URL and return discovered leads.
 */
async function scrapeDirectoryUrl(
  url: string,
  icp: ICP,
  page: Page,
): Promise<DiscoveredLeadData[]> {
  const directory = identifyDirectory(url);
  if (!directory) {
    console.warn(`[DirectoryScraper] Unknown directory URL: ${url}`);
    return [];
  }

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Check for CAPTCHA
    if (await detectCaptcha(page)) {
      console.warn(`[DirectoryScraper] CAPTCHA detected on ${url}, skipping`);
      return [];
    }

    switch (directory) {
      case 'crunchbase': {
        const data = await extractCrunchbase(page);
        const filtered = filterByRole(data.teamMembers, icp.targetRole);
        return filtered.map((member) => ({
          name: member.name,
          role: member.role,
          company: data.companyName,
          industry: data.industry || icp.industry,
          geography: icp.geography,
          discoverySource: 'crunchbase_scrape',
        }));
      }

      case 'angellist': {
        const data = await extractAngelList(page);
        const filtered = filterByRole(data.teamMembers, icp.targetRole);
        return filtered.map((member) => ({
          name: member.name,
          role: member.role,
          company: data.companyName,
          industry: icp.industry,
          geography: icp.geography,
          discoverySource: 'angellist_scrape',
        }));
      }

      case 'yc': {
        const data = await extractYC(page);
        const filtered = filterByRole(data.founders, icp.targetRole);
        return filtered.map((member) => ({
          name: member.name,
          role: member.role,
          company: data.companyName,
          industry: icp.industry,
          geography: icp.geography,
          discoverySource: 'yc_scrape',
        }));
      }

      default:
        return [];
    }
  } catch (error) {
    // Handle page structure changes gracefully — log and return empty
    console.error(
      `[DirectoryScraper] Failed to extract from ${url}:`,
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Directory Scraper — Source Adapter
// ---------------------------------------------------------------------------

export const directoryScraper: SourceAdapter = {
  name: 'directory_scrape',
  capabilities: ['discovery'],

  isEnabled(): boolean {
    const envVal = process.env.DIRECTORY_SCRAPING_ENABLED;
    // Default to true if not set
    return envVal === undefined || envVal === '' || envVal.toLowerCase() === 'true';
  },

  async discover(queries: AnnotatedQuery[], icp: ICP): Promise<DiscoveredLeadData[]> {
    if (!this.isEnabled()) {
      console.log('[DirectoryScraper] Adapter is disabled, skipping discovery');
      return [];
    }

    // Collect directory URLs from queries annotated with 'directory' vector
    const directoryUrls = queries
      .filter((q) => q.vector === 'directory')
      .map((q) => q.query)
      .filter((url) => identifyDirectory(url) !== null);

    if (directoryUrls.length === 0) {
      console.log('[DirectoryScraper] No directory URLs to process');
      return [];
    }

    const allLeads: DiscoveredLeadData[] = [];
    const browser = await launchBrowser();

    try {
      for (const url of directoryUrls) {
        try {
          await acquirePermit(RATE_LIMIT_SOURCE);

          const page = await createPage(browser, new URL(url).hostname);

          try {
            const leads = await scrapeDirectoryUrl(url, icp, page);
            recordRequest(RATE_LIMIT_SOURCE);
            allLeads.push(...leads);
          } finally {
            await page.context().close();
          }
        } catch (error) {
          console.error(
            `[DirectoryScraper] Error processing ${url}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } finally {
      await closeBrowser(browser);
    }

    console.log(
      `[DirectoryScraper] Discovery complete: ${allLeads.length} leads from ${directoryUrls.length} directory URLs`,
    );

    return allLeads;
  },
};
