import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('./rateLimiter', () => ({
  acquirePermit: vi.fn().mockResolvedValue(undefined),
  recordRequest: vi.fn(),
}));

import { acquirePermit, recordRequest } from './rateLimiter';
import {
  inferCompanyFromBio,
  inferIndustryFromContent,
  inferRoleFromBio,
  twitterScraper,
} from './twitterScraper';

// ---------------------------------------------------------------------------
// Global fetch mock helper
// ---------------------------------------------------------------------------

function mockFetchResponse(data: object, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(data),
  });
}

// ---------------------------------------------------------------------------
// inferRoleFromBio tests
// ---------------------------------------------------------------------------

describe('inferRoleFromBio', () => {
  it('returns null for empty bio', () => {
    expect(inferRoleFromBio('')).toBeNull();
  });

  it('detects CEO role', () => {
    expect(inferRoleFromBio('CEO at TechCorp')).toBe('CEO');
  });

  it('detects CTO role', () => {
    expect(inferRoleFromBio('CTO & Co-Founder')).toBe('CTO');
  });

  it('detects Founder role', () => {
    expect(inferRoleFromBio('Founder of StartupXYZ')).toBe('Founder');
  });

  it('detects Co-Founder role', () => {
    expect(inferRoleFromBio('Co-founder building the future')).toBe('Co-Founder');
  });

  it('detects VP Engineering', () => {
    expect(inferRoleFromBio('VP of Engineering at BigCo')).toBe('VP Engineering');
  });

  it('detects Software Engineer', () => {
    expect(inferRoleFromBio('Senior Software Engineer')).toBe('Senior Software Engineer');
  });

  it('detects Product Manager', () => {
    expect(inferRoleFromBio('Product Manager | Building great products')).toBe('Product Manager');
  });

  it('returns null for unrecognizable bio', () => {
    expect(inferRoleFromBio('Love coffee and hiking')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inferCompanyFromBio tests
// ---------------------------------------------------------------------------

describe('inferCompanyFromBio', () => {
  it('returns null for empty bio', () => {
    expect(inferCompanyFromBio('')).toBeNull();
  });

  it('extracts company from "at CompanyName" pattern', () => {
    expect(inferCompanyFromBio('Engineer at Acme')).toBe('Acme');
  });

  it('extracts company from "Building CompanyName" pattern', () => {
    expect(inferCompanyFromBio('Building Stripe for healthcare')).toBe('Stripe');
  });

  it('extracts company from "Founder of CompanyName" pattern', () => {
    expect(inferCompanyFromBio('Founder of TechCorp')).toBe('TechCorp');
  });

  it('extracts company from "CEO of CompanyName" pattern', () => {
    expect(inferCompanyFromBio('CEO of DataFlow')).toBe('DataFlow');
  });

  it('returns null when no company pattern found', () => {
    expect(inferCompanyFromBio('Love building things')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inferIndustryFromContent tests
// ---------------------------------------------------------------------------

describe('inferIndustryFromContent', () => {
  it('returns null for empty content', () => {
    expect(inferIndustryFromContent('', [])).toBeNull();
  });

  it('detects SaaS from bio', () => {
    expect(inferIndustryFromContent('Building SaaS products', [])).toBe('SaaS');
  });

  it('detects Fintech from tweets', () => {
    expect(inferIndustryFromContent('', ['Working on fintech solutions'])).toBe('Fintech');
  });

  it('detects AI from combined content', () => {
    expect(inferIndustryFromContent('ML researcher', ['Training AI models'])).toBe(
      'Artificial Intelligence',
    );
  });

  it('detects Cybersecurity', () => {
    expect(inferIndustryFromContent('Cybersecurity expert', [])).toBe('Cybersecurity');
  });

  it('returns null for unrecognizable content', () => {
    expect(inferIndustryFromContent('Love coffee', ['Great weather today'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Adapter property tests
// ---------------------------------------------------------------------------

describe('twitterScraper adapter properties', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SERPER_API_KEY = 'test-serper-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('has correct name', () => {
    expect(twitterScraper.name).toBe('twitter_scrape');
  });

  it('has discovery and enrichment capabilities', () => {
    expect(twitterScraper.capabilities).toEqual(['discovery', 'enrichment']);
  });

  it('isEnabled returns true when SERPER_API_KEY is set', () => {
    delete process.env.TWITTER_SCRAPING_ENABLED;
    expect(twitterScraper.isEnabled()).toBe(true);
  });

  it('isEnabled returns false when SERPER_API_KEY is not set', () => {
    delete process.env.SERPER_API_KEY;
    delete process.env.TWITTER_SCRAPING_ENABLED;
    expect(twitterScraper.isEnabled()).toBe(false);
  });

  it('isEnabled returns false when TWITTER_SCRAPING_ENABLED is false', () => {
    process.env.TWITTER_SCRAPING_ENABLED = 'false';
    expect(twitterScraper.isEnabled()).toBe(false);
  });

  it('isEnabled returns true when TWITTER_SCRAPING_ENABLED is true', () => {
    process.env.TWITTER_SCRAPING_ENABLED = 'true';
    expect(twitterScraper.isEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// discover() tests
// ---------------------------------------------------------------------------

describe('twitterScraper.discover', () => {
  const originalEnv = process.env;

  const mockIcp = {
    id: 'test-icp',
    founderId: 'founder-1',
    targetRole: 'CTO',
    industry: 'SaaS',
    companyStage: 'Series A',
    geography: 'US',
    customTags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockQueries = [{ query: 'CTO SaaS startup', vector: 'twitter' as const }];

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SERPER_API_KEY = 'test-serper-key';
    delete process.env.TWITTER_SCRAPING_ENABLED;
    vi.clearAllMocks();
    vi.mocked(acquirePermit).mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns empty array when disabled', async () => {
    process.env.TWITTER_SCRAPING_ENABLED = 'false';
    const results = await twitterScraper.discover!(mockQueries, mockIcp);
    expect(results).toEqual([]);
  });

  it('returns empty array when SERPER_API_KEY is not set', async () => {
    delete process.env.SERPER_API_KEY;
    const results = await twitterScraper.discover!(mockQueries, mockIcp);
    expect(results).toEqual([]);
  });

  it('returns empty array when no twitter queries', async () => {
    const nonTwitterQueries = [{ query: 'test', vector: 'linkedin' as const }];
    const results = await twitterScraper.discover!(nonTwitterQueries, mockIcp);
    expect(results).toEqual([]);
  });

  it('calls Serper API via fetch for discovery', async () => {
    const fetchMock = mockFetchResponse({
      organic: [
        {
          title: 'Jane Smith (@janesmith) / X',
          link: 'https://x.com/janesmith',
          snippet: 'CTO at Acme Corp. Building SaaS products.',
          position: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const results = await twitterScraper.discover!(mockQueries, mockIcp);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://google.serper.dev/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-KEY': 'test-serper-key',
          'Content-Type': 'application/json',
        }),
      }),
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Jane Smith');
    expect(results[0].company).toBe('Acme Corp');
  });

  it('acquires rate limit permit for search', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({ organic: [] }));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await twitterScraper.discover!(mockQueries, mockIcp);
    expect(acquirePermit).toHaveBeenCalledWith('twitter');
  });

  it('records requests after successful API call', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({ organic: [] }));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await twitterScraper.discover!(mockQueries, mockIcp);
    expect(recordRequest).toHaveBeenCalledWith('twitter');
  });

  it('handles API errors gracefully', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({}, false, 500));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const results = await twitterScraper.discover!(mockQueries, mockIcp);
    expect(results).toEqual([]);
  });

  it('deduplicates results by twitter handle', async () => {
    const fetchMock = mockFetchResponse({
      organic: [
        {
          title: 'Jane Smith (@janesmith) / X',
          link: 'https://x.com/janesmith',
          snippet: 'CTO at Acme Corp',
          position: 1,
        },
        {
          title: 'Jane Smith (@janesmith) / X',
          link: 'https://x.com/janesmith',
          snippet: 'CTO at Acme Corp',
          position: 2,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const results = await twitterScraper.discover!(mockQueries, mockIcp);
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// enrich() tests
// ---------------------------------------------------------------------------

describe('twitterScraper.enrich', () => {
  const originalEnv = process.env;

  const mockProspect = {
    name: 'John Doe',
    company: 'Acme Corp',
    twitterHandle: 'johndoe',
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SERPER_API_KEY = 'test-serper-key';
    delete process.env.TWITTER_SCRAPING_ENABLED;
    vi.clearAllMocks();
    vi.mocked(acquirePermit).mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns empty when disabled', async () => {
    process.env.TWITTER_SCRAPING_ENABLED = 'false';
    const result = await twitterScraper.enrich!(mockProspect);
    expect(result).toEqual({});
  });

  it('returns empty when SERPER_API_KEY is not set', async () => {
    delete process.env.SERPER_API_KEY;
    const result = await twitterScraper.enrich!(mockProspect);
    expect(result).toEqual({});
  });

  it('returns empty when no twitter handle', async () => {
    const result = await twitterScraper.enrich!({ name: 'John', company: 'Acme' });
    expect(result).toEqual({});
  });

  it('calls Serper API via fetch for enrichment', async () => {
    const fetchMock = mockFetchResponse({
      organic: [
        {
          title: 'John Doe (@johndoe) / X',
          link: 'https://x.com/johndoe',
          snippet: 'CTO building the future of SaaS',
          position: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await twitterScraper.enrich!(mockProspect);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://google.serper.dev/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-KEY': 'test-serper-key',
        }),
      }),
    );

    expect(result.linkedinBio).toBe('CTO building the future of SaaS');
    expect(result.dataSources).toEqual(['twitter_scrape']);
  });

  it('acquires rate limit permit', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({ organic: [] }));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await twitterScraper.enrich!(mockProspect);
    expect(acquirePermit).toHaveBeenCalledWith('twitter');
  });

  it('returns empty when no matching profile found', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse({
        organic: [
          {
            title: 'Someone Else (@other) / X',
            link: 'https://x.com/other',
            snippet: 'Not the right person',
            position: 1,
          },
        ],
      }),
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await twitterScraper.enrich!(mockProspect);
    expect(result).toEqual({});
  });

  it('handles fetch errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await twitterScraper.enrich!(mockProspect);
    expect(result).toEqual({});
  });
});
