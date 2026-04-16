import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('./antiDetection', () => ({
  shuffleAdapterOrder: vi.fn(<T>(arr: T[]) => [...arr]),
}));

vi.mock('./healthMonitor', () => ({
  isSourceAvailable: vi.fn().mockReturnValue(true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock('./rateLimiter', () => ({
  acquirePermit: vi.fn().mockResolvedValue(undefined),
  recordRequest: vi.fn(),
}));

vi.mock('./queryGenerator', () => ({
  generateQueries: vi.fn().mockResolvedValue({
    queries: [
      { query: 'test query 1', vector: 'linkedin' },
      { query: 'test query 2', vector: 'general' },
    ],
    generationMethod: 'template_fallback',
  }),
}));

vi.mock('./googleSearchScraper', () => ({
  googleSearchScraper: {
    name: 'google_search',
    capabilities: ['discovery'],
    isEnabled: vi.fn().mockReturnValue(true),
    discover: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./directoryScraper', () => ({
  directoryScraper: {
    name: 'directory_scrape',
    capabilities: ['discovery'],
    isEnabled: vi.fn().mockReturnValue(true),
    discover: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./serpApiSearchAdapter', () => ({
  serpApiSearchAdapter: {
    name: 'serp_api_search',
    capabilities: ['discovery'],
    isEnabled: vi.fn().mockReturnValue(true),
    discover: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./githubScraper', () => ({
  githubScraper: {
    name: 'github_scrape',
    capabilities: ['discovery', 'enrichment'],
    isEnabled: vi.fn().mockReturnValue(true),
    discover: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./twitterScraper', () => ({
  twitterScraper: {
    name: 'twitter_scrape',
    capabilities: ['discovery', 'enrichment'],
    isEnabled: vi.fn().mockReturnValue(true),
    discover: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./mapsScraper', () => ({
  mapsScraper: {
    name: 'maps_scrape',
    capabilities: ['discovery'],
    isEnabled: vi.fn().mockReturnValue(true),
    discover: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./premiumAdapters', () => ({
  apolloAdapter: {
    name: 'apollo_api',
    capabilities: ['discovery'],
    isEnabled: vi.fn().mockReturnValue(false),
    discover: vi.fn().mockResolvedValue([]),
  },
}));

import type { ICP } from '@/types';
import { shuffleAdapterOrder } from './antiDetection';
import { directoryScraper } from './directoryScraper';
import {
  deduplicateProspects,
  discoverLeads,
  mergeProspects,
  normalizeNameCompany,
} from './discoveryEngine';
import { githubScraper } from './githubScraper';
import { googleSearchScraper } from './googleSearchScraper';
import { isSourceAvailable, recordFailure, recordSuccess } from './healthMonitor';
import { mapsScraper } from './mapsScraper';
import { apolloAdapter } from './premiumAdapters';
import { acquirePermit } from './rateLimiter';
import { serpApiSearchAdapter } from './serpApiSearchAdapter';
import { twitterScraper } from './twitterScraper';
import type { DiscoveredLeadData } from './types';

const mockIcp: ICP = {
  id: 'icp-1',
  founderId: 'founder-1',
  targetRole: 'CTO',
  industry: 'SaaS',
  geography: 'San Francisco',
  companyStage: 'Series A',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('discoveryEngine', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set env vars so API adapters are enabled and browser scrapers are included
    process.env = { ...originalEnv };
    process.env.SERPER_API_KEY = 'test-serper-key';
    // Enable proxies so browser scrapers (googleSearchScraper, directoryScraper) are included
    process.env.SCRAPING_PROXY_ENABLED = 'true';
    process.env.SCRAPING_PROXY_LIST = 'http://proxy1:8080';

    // Re-set default mock return values
    vi.mocked(googleSearchScraper.isEnabled).mockReturnValue(true);
    vi.mocked(directoryScraper.isEnabled).mockReturnValue(true);
    vi.mocked(serpApiSearchAdapter.isEnabled).mockReturnValue(true);
    vi.mocked(githubScraper.isEnabled).mockReturnValue(true);
    vi.mocked(twitterScraper.isEnabled).mockReturnValue(true);
    vi.mocked(mapsScraper.isEnabled).mockReturnValue(true);
    vi.mocked(apolloAdapter.isEnabled).mockReturnValue(false);
    vi.mocked(isSourceAvailable).mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('normalizeNameCompany', () => {
    it('lowercases and trims name and company', () => {
      expect(normalizeNameCompany('  John DOE  ', '  Acme Corp  ')).toBe('john doe|acme corp');
    });

    it('collapses multiple whitespace', () => {
      expect(normalizeNameCompany('John   Doe', 'Acme   Corp')).toBe('john doe|acme corp');
    });

    it('handles empty strings', () => {
      expect(normalizeNameCompany('', '')).toBe('|');
    });

    it('handles null-ish values gracefully', () => {
      expect(normalizeNameCompany(undefined as unknown as string, null as unknown as string)).toBe(
        '|',
      );
    });
  });

  describe('mergeProspects', () => {
    it('prefers non-empty fields over empty', () => {
      const existing: DiscoveredLeadData = {
        name: 'John',
        role: '',
        company: 'Acme',
        industry: '',
        geography: '',
      };
      const incoming: DiscoveredLeadData = {
        name: '',
        role: 'CTO',
        company: '',
        industry: 'SaaS',
        geography: 'SF',
      };
      const merged = mergeProspects(existing, incoming);
      expect(merged.name).toBe('John');
      expect(merged.role).toBe('CTO');
      expect(merged.company).toBe('Acme');
      expect(merged.industry).toBe('SaaS');
      expect(merged.geography).toBe('SF');
    });

    it('prefers longer value when both are non-empty', () => {
      const existing: DiscoveredLeadData = {
        name: 'John Doe',
        role: 'CTO',
        company: 'Acme',
        industry: '',
        geography: '',
      };
      const incoming: DiscoveredLeadData = {
        name: 'John',
        role: 'Chief Technology Officer',
        company: 'Acme Corp',
        industry: '',
        geography: '',
      };
      const merged = mergeProspects(existing, incoming);
      expect(merged.name).toBe('John Doe');
      expect(merged.role).toBe('Chief Technology Officer');
      expect(merged.company).toBe('Acme Corp');
    });

    it('merges discovery sources from different adapters', () => {
      const existing: DiscoveredLeadData = {
        name: 'John',
        role: 'CTO',
        company: 'Acme',
        discoverySource: 'google_search',
      };
      const incoming: DiscoveredLeadData = {
        name: 'John',
        role: 'CTO',
        company: 'Acme',
        discoverySource: 'github_scrape',
      };
      const merged = mergeProspects(existing, incoming);
      expect(merged.discoverySource).toContain('google_search');
      expect(merged.discoverySource).toContain('github_scrape');
    });

    it('merges optional fields like linkedinUrl and companyDomain', () => {
      const existing: DiscoveredLeadData = {
        name: 'John',
        role: 'CTO',
        company: 'Acme',
        linkedinUrl: 'https://linkedin.com/in/john',
      };
      const incoming: DiscoveredLeadData = {
        name: 'John',
        role: 'CTO',
        company: 'Acme',
        companyDomain: 'acme.com',
        githubUsername: 'johndoe',
      };
      const merged = mergeProspects(existing, incoming);
      expect(merged.linkedinUrl).toBe('https://linkedin.com/in/john');
      expect(merged.companyDomain).toBe('acme.com');
      expect(merged.githubUsername).toBe('johndoe');
    });
  });

  describe('deduplicateProspects', () => {
    it('removes duplicates by normalized name + company', () => {
      const prospects: DiscoveredLeadData[] = [
        { name: 'John Doe', role: 'CTO', company: 'Acme Corp' },
        { name: 'john doe', role: 'Chief Technology Officer', company: 'acme corp' },
        { name: 'Jane Smith', role: 'VP Eng', company: 'Beta Inc' },
      ];
      const result = deduplicateProspects(prospects);
      expect(result).toHaveLength(2);
    });

    it('merges data when deduplicating', () => {
      const prospects: DiscoveredLeadData[] = [
        {
          name: 'John Doe',
          role: '',
          company: 'Acme',
          linkedinUrl: 'https://linkedin.com/in/john',
        },
        { name: 'John Doe', role: 'CTO', company: 'Acme', companyDomain: 'acme.com' },
      ];
      const result = deduplicateProspects(prospects);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('CTO');
      expect(result[0].linkedinUrl).toBe('https://linkedin.com/in/john');
      expect(result[0].companyDomain).toBe('acme.com');
    });

    it('returns empty array for empty input', () => {
      expect(deduplicateProspects([])).toEqual([]);
    });

    it('preserves all unique prospects', () => {
      const prospects: DiscoveredLeadData[] = [
        { name: 'A', role: 'R1', company: 'C1' },
        { name: 'B', role: 'R2', company: 'C2' },
        { name: 'C', role: 'R3', company: 'C3' },
      ];
      expect(deduplicateProspects(prospects)).toHaveLength(3);
    });
  });

  describe('discoverLeads', () => {
    it('returns empty array when all sources are disabled', async () => {
      vi.mocked(googleSearchScraper.isEnabled).mockReturnValue(false);
      vi.mocked(directoryScraper.isEnabled).mockReturnValue(false);
      vi.mocked(serpApiSearchAdapter.isEnabled).mockReturnValue(false);
      vi.mocked(githubScraper.isEnabled).mockReturnValue(false);
      vi.mocked(twitterScraper.isEnabled).mockReturnValue(false);
      vi.mocked(mapsScraper.isEnabled).mockReturnValue(false);
      vi.mocked(apolloAdapter.isEnabled).mockReturnValue(false);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await discoverLeads(mockIcp);
      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('All discovery sources are disabled'),
      );
      consoleSpy.mockRestore();
    });

    it('calls shuffleAdapterOrder for anti-detection', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await discoverLeads(mockIcp);
      expect(shuffleAdapterOrder).toHaveBeenCalled();
    });

    it('checks source health before calling each adapter', async () => {
      vi.mocked(isSourceAvailable).mockReturnValue(false);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await discoverLeads(mockIcp);
      expect(isSourceAvailable).toHaveBeenCalled();
    });

    it('records success on successful adapter call', async () => {
      vi.mocked(githubScraper.discover!).mockResolvedValue([
        { name: 'John', role: 'CTO', company: 'Acme' },
      ]);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await discoverLeads(mockIcp);
      expect(recordSuccess).toHaveBeenCalled();
    });

    it('records failure and continues when adapter throws', async () => {
      vi.mocked(githubScraper.discover!).mockRejectedValue(new Error('scrape failed'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await discoverLeads(mockIcp);
      expect(recordFailure).toHaveBeenCalledWith('github_scrape');
      expect(result).toBeDefined();
    });

    it('attaches discoverySource to results', async () => {
      vi.mocked(githubScraper.discover!).mockResolvedValue([
        { name: 'John Smith', role: 'CTO', company: 'Acme' },
      ]);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await discoverLeads(mockIcp);
      expect(result[0].discoverySource).toBe('github_scrape');
    });

    it('deduplicates results from multiple sources', async () => {
      vi.mocked(googleSearchScraper.discover!).mockResolvedValue([
        { name: 'John Doe', role: 'CTO', company: 'Acme' },
      ]);
      vi.mocked(githubScraper.discover!).mockResolvedValue([
        {
          name: 'John Doe',
          role: 'Chief Technology Officer',
          company: 'Acme',
          githubUsername: 'johndoe',
        },
      ]);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await discoverLeads(mockIcp);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('Chief Technology Officer');
      expect(result[0].githubUsername).toBe('johndoe');
    });

    it('applies rate limiting before each adapter call', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await discoverLeads(mockIcp);
      expect(acquirePermit).toHaveBeenCalled();
    });

    it('logs empty results from individual adapters and continues', async () => {
      vi.mocked(googleSearchScraper.discover!).mockResolvedValue([]);
      vi.mocked(githubScraper.discover!).mockResolvedValue([
        { name: 'Jane Smith', role: 'Eng', company: 'Beta' },
      ]);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await discoverLeads(mockIcp);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });
});
