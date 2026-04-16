import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all dependencies with explicit factories
vi.mock('playwright', () => ({
  chromium: { launch: vi.fn() },
}));

vi.mock('./antiDetection', () => ({
  getNextUserAgent: vi.fn(),
  getNextProxy: vi.fn(),
  getRandomDelay: vi.fn(),
  applyAntiDetection: vi.fn(),
  checkRobotsTxt: vi.fn(),
  shuffleAdapterOrder: vi.fn(),
  getConfig: vi.fn(),
  _resetForTesting: vi.fn(),
  _getUserAgentPoolSize: vi.fn(),
  _getRobotsTxtCache: vi.fn(),
}));

vi.mock('./rateLimiter', () => ({
  acquirePermit: vi.fn(),
  recordRequest: vi.fn(),
  isDailyBudgetExhausted: vi.fn(),
  applyBackoff: vi.fn(),
  getStatus: vi.fn(),
  _resetForTesting: vi.fn(),
  _getWindowTimestamps: vi.fn(),
  _getDailyCount: vi.fn(),
}));

vi.mock('./scraperUtils', () => ({
  launchBrowser: vi.fn(),
  createPage: vi.fn(),
  closeBrowser: vi.fn(),
  detectCaptcha: vi.fn(),
  waitWithRandomDelay: vi.fn(),
}));

// Dynamic imports to ensure mocks are applied first
let classifyUrl: typeof import('./googleSearchScraper').classifyUrl;
let normalizeUrl: typeof import('./googleSearchScraper').normalizeUrl;
let deduplicateResults: typeof import('./googleSearchScraper').deduplicateResults;
let extractNameFromSnippet: typeof import('./googleSearchScraper').extractNameFromSnippet;
let googleSearchScraper: typeof import('./googleSearchScraper').googleSearchScraper;

let acquirePermit: any;
let recordRequest: any;
let launchBrowser: any;
let createPage: any;
let closeBrowser: any;
let detectCaptcha: any;

function makeMockPage(evaluateResult: any[] = []) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue(null),
    context: vi.fn().mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();

  const mod = await import('./googleSearchScraper');
  classifyUrl = mod.classifyUrl;
  normalizeUrl = mod.normalizeUrl;
  deduplicateResults = mod.deduplicateResults;
  extractNameFromSnippet = mod.extractNameFromSnippet;
  googleSearchScraper = mod.googleSearchScraper;

  const rl = await import('./rateLimiter');
  acquirePermit = rl.acquirePermit;
  recordRequest = rl.recordRequest;
  vi.mocked(acquirePermit).mockResolvedValue(undefined);
  vi.mocked(recordRequest).mockReturnValue(undefined);

  const su = await import('./scraperUtils');
  launchBrowser = su.launchBrowser;
  createPage = su.createPage;
  closeBrowser = su.closeBrowser;
  detectCaptcha = su.detectCaptcha;

  vi.mocked(launchBrowser).mockResolvedValue({ close: vi.fn() } as any);
  vi.mocked(createPage).mockResolvedValue(makeMockPage() as any);
  vi.mocked(closeBrowser).mockResolvedValue(undefined);
  vi.mocked(detectCaptcha).mockResolvedValue(false);

  const ad = await import('./antiDetection');
  vi.mocked(ad.getRandomDelay).mockReturnValue(3);
  vi.mocked(ad.getNextUserAgent).mockReturnValue('Mozilla/5.0 TestAgent');
  vi.mocked(ad.getNextProxy).mockReturnValue(null);
  vi.mocked(ad.applyAntiDetection).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Helper function tests (pure functions)
// ---------------------------------------------------------------------------

describe('classifyUrl', () => {
  it('classifies LinkedIn profile URLs', () => {
    expect(classifyUrl('https://www.linkedin.com/in/john-doe')).toBe('linkedin');
    expect(classifyUrl('https://linkedin.com/in/jane-smith-123')).toBe('linkedin');
  });

  it('classifies Crunchbase URLs as directory', () => {
    expect(classifyUrl('https://www.crunchbase.com/organization/acme-corp')).toBe('directory');
    expect(classifyUrl('https://www.crunchbase.com/person/john-doe')).toBe('directory');
  });

  it('classifies AngelList/Wellfound URLs as directory', () => {
    expect(classifyUrl('https://angel.co/company/acme')).toBe('directory');
    expect(classifyUrl('https://wellfound.com/company/acme')).toBe('directory');
  });

  it('classifies YC URLs as directory', () => {
    expect(classifyUrl('https://www.ycombinator.com/companies/acme')).toBe('directory');
  });

  it('classifies other URLs as other', () => {
    expect(classifyUrl('https://example.com')).toBe('other');
    expect(classifyUrl('https://github.com/user')).toBe('other');
    expect(classifyUrl('https://linkedin.com/company/acme')).toBe('other');
  });
});

describe('normalizeUrl', () => {
  it('lowercases URLs', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Path')).toBe('https://example.com/path');
  });

  it('removes trailing slashes', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    expect(normalizeUrl('https://example.com/path///')).toBe('https://example.com/path');
  });

  it('handles URLs without trailing slashes', () => {
    expect(normalizeUrl('https://example.com/path')).toBe('https://example.com/path');
  });
});

describe('deduplicateResults', () => {
  it('removes duplicates by normalized URL', () => {
    const results = [
      { url: 'https://example.com/a', title: 'A', snippet: 'Snippet A' },
      { url: 'https://EXAMPLE.COM/a/', title: 'A dup', snippet: 'Snippet A dup' },
      { url: 'https://example.com/b', title: 'B', snippet: 'Snippet B' },
    ];
    const deduped = deduplicateResults(results);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].title).toBe('A');
    expect(deduped[1].title).toBe('B');
  });

  it('keeps first occurrence when duplicates exist', () => {
    const results = [
      { url: 'https://example.com/page', title: 'First', snippet: 'First snippet' },
      { url: 'https://example.com/page/', title: 'Second', snippet: 'Second snippet' },
    ];
    const deduped = deduplicateResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe('First');
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateResults([])).toEqual([]);
  });

  it('output is a subset of input', () => {
    const results = [
      { url: 'https://a.com', title: 'A', snippet: 'A' },
      { url: 'https://b.com', title: 'B', snippet: 'B' },
    ];
    const deduped = deduplicateResults(results);
    for (const r of deduped) {
      expect(results).toContainEqual(r);
    }
  });
});

describe('extractNameFromSnippet', () => {
  it('extracts name before dash separator', () => {
    expect(extractNameFromSnippet('John Doe - Software Engineer at Acme')).toBe('John Doe');
  });

  it('extracts name before pipe separator', () => {
    expect(extractNameFromSnippet('Jane Smith | CTO at StartupCo')).toBe('Jane Smith');
  });

  it('extracts name before en-dash separator', () => {
    expect(extractNameFromSnippet('Alex Johnson – VP Engineering')).toBe('Alex Johnson');
  });

  it('returns null for empty snippet', () => {
    expect(extractNameFromSnippet('')).toBeNull();
    expect(extractNameFromSnippet('   ')).toBeNull();
  });

  it('falls back to first line for short text without separators', () => {
    expect(extractNameFromSnippet('John Doe')).toBe('John Doe');
  });

  it('returns null for URLs in first line', () => {
    expect(
      extractNameFromSnippet('https://example.com/some-long-path-that-is-not-a-name'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Adapter property tests
// ---------------------------------------------------------------------------

describe('googleSearchScraper adapter properties', () => {
  it('has correct name', () => {
    expect(googleSearchScraper.name).toBe('google_search');
  });

  it('has discovery capability', () => {
    expect(googleSearchScraper.capabilities).toEqual(['discovery']);
  });

  it('isEnabled returns true by default', () => {
    delete process.env.GOOGLE_SEARCH_ENABLED;
    expect(googleSearchScraper.isEnabled()).toBe(true);
  });

  it('isEnabled returns false when env var is false', () => {
    process.env.GOOGLE_SEARCH_ENABLED = 'false';
    expect(googleSearchScraper.isEnabled()).toBe(false);
    delete process.env.GOOGLE_SEARCH_ENABLED;
  });

  it('isEnabled returns true when env var is true', () => {
    process.env.GOOGLE_SEARCH_ENABLED = 'true';
    expect(googleSearchScraper.isEnabled()).toBe(true);
    delete process.env.GOOGLE_SEARCH_ENABLED;
  });
});

// ---------------------------------------------------------------------------
// discover() integration tests
// ---------------------------------------------------------------------------

describe('googleSearchScraper.discover', () => {
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

  const mockQueries = [{ query: 'site:linkedin.com/in CTO SaaS', vector: 'linkedin' as const }];

  beforeEach(() => {
    delete process.env.GOOGLE_SEARCH_ENABLED;
  });

  it('returns empty array when disabled', async () => {
    process.env.GOOGLE_SEARCH_ENABLED = 'false';
    const results = await googleSearchScraper.discover!(mockQueries, mockIcp);
    expect(results).toEqual([]);
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it('launches browser and closes it after discovery', async () => {
    await googleSearchScraper.discover!(mockQueries, mockIcp);
    expect(launchBrowser).toHaveBeenCalledOnce();
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it('acquires rate limit permit for each page', async () => {
    await googleSearchScraper.discover!(mockQueries, mockIcp);
    // 1 query × 3 pages = 3 permits
    expect(acquirePermit).toHaveBeenCalledTimes(3);
    expect(acquirePermit).toHaveBeenCalledWith('google');
  });

  it('creates a page for each search page', async () => {
    await googleSearchScraper.discover!(mockQueries, mockIcp);
    expect(createPage).toHaveBeenCalledTimes(3);
  });

  it('handles CAPTCHA by aborting current query and continuing', async () => {
    vi.mocked(detectCaptcha).mockResolvedValueOnce(true);

    const queries = [
      { query: 'query1', vector: 'linkedin' as const },
      { query: 'query2', vector: 'linkedin' as const },
    ];

    await googleSearchScraper.discover!(queries, mockIcp);

    // First query: CAPTCHA on page 1, aborted (1 page attempt)
    // Second query: 3 pages
    // Total: 4 createPage calls
    expect(createPage).toHaveBeenCalledTimes(4);
  });

  it('extracts LinkedIn leads from results', async () => {
    vi.mocked(createPage).mockResolvedValue(
      makeMockPage([
        {
          url: 'https://www.linkedin.com/in/john-doe',
          title: 'John Doe - CTO',
          snippet: 'John Doe - CTO at Acme Corp',
        },
      ]) as any,
    );

    const results = await googleSearchScraper.discover!(mockQueries, mockIcp);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const lead = results[0];
    expect(lead.name).toBe('John Doe');
    expect(lead.discoverySource).toBe('google_search');
    expect(lead.linkedinUrl).toBe('https://www.linkedin.com/in/john-doe');
  });

  it('records requests after successful page scrape', async () => {
    await googleSearchScraper.discover!(mockQueries, mockIcp);
    expect(recordRequest).toHaveBeenCalledWith('google');
  });

  it('closes browser even when errors occur', async () => {
    vi.mocked(createPage).mockRejectedValue(new Error('browser error'));
    await googleSearchScraper.discover!(mockQueries, mockIcp);
    expect(closeBrowser).toHaveBeenCalledOnce();
  });
});
