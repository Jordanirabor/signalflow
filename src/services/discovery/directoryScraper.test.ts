import { vi } from 'vitest';

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
let filterByRole: typeof import('./directoryScraper').filterByRole;
let identifyDirectory: typeof import('./directoryScraper').identifyDirectory;
let directoryScraper: typeof import('./directoryScraper').directoryScraper;

let acquirePermit: any;
let recordRequest: any;
let launchBrowser: any;
let createPage: any;
let closeBrowser: any;
let detectCaptcha: any;

function makeMockPage(evaluateResult: any = {}) {
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

beforeEach(async () => {
  vi.clearAllMocks();

  const mod = await import('./directoryScraper');
  filterByRole = mod.filterByRole;
  identifyDirectory = mod.identifyDirectory;
  directoryScraper = mod.directoryScraper;

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
// identifyDirectory
// ---------------------------------------------------------------------------

describe('identifyDirectory', () => {
  it('identifies Crunchbase organization URLs', () => {
    expect(identifyDirectory('https://www.crunchbase.com/organization/acme-corp')).toBe(
      'crunchbase',
    );
  });

  it('identifies Crunchbase person URLs', () => {
    expect(identifyDirectory('https://www.crunchbase.com/person/john-doe')).toBe('crunchbase');
  });

  it('identifies AngelList URLs', () => {
    expect(identifyDirectory('https://angel.co/company/acme')).toBe('angellist');
  });

  it('identifies Wellfound URLs', () => {
    expect(identifyDirectory('https://wellfound.com/company/acme')).toBe('angellist');
  });

  it('identifies Y Combinator URLs', () => {
    expect(identifyDirectory('https://www.ycombinator.com/companies/acme')).toBe('yc');
  });

  it('returns null for unknown URLs', () => {
    expect(identifyDirectory('https://example.com')).toBeNull();
    expect(identifyDirectory('https://github.com/user')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterByRole
// ---------------------------------------------------------------------------

describe('filterByRole', () => {
  const members = [
    { name: 'Alice', role: 'CTO' },
    { name: 'Bob', role: 'Chief Technology Officer' },
    { name: 'Charlie', role: 'VP Sales' },
    { name: 'Diana', role: 'Software Engineer' },
    { name: 'Eve', role: 'Marketing Manager' },
    { name: 'Frank', role: 'VP Engineering' },
  ];

  it('matches exact role (case-insensitive)', () => {
    const result = filterByRole(members, 'CTO');
    expect(result.some((m) => m.name === 'Alice')).toBe(true);
  });

  it('matches role synonyms (CTO ↔ Chief Technology Officer)', () => {
    const result = filterByRole(members, 'CTO');
    expect(result.some((m) => m.name === 'Bob')).toBe(true);
  });

  it('matches VP Engineering synonyms', () => {
    const result = filterByRole(members, 'VP Engineering');
    expect(result.some((m) => m.name === 'Frank')).toBe(true);
  });

  it('does not include unrelated roles', () => {
    const result = filterByRole(members, 'CTO');
    expect(result.some((m) => m.name === 'Eve')).toBe(false);
  });

  it('returns all members when targetRole is empty', () => {
    const result = filterByRole(members, '');
    expect(result).toEqual(members);
  });

  it('handles members with empty roles', () => {
    const withEmpty = [{ name: 'NoRole', role: '' }];
    const result = filterByRole(withEmpty, 'CTO');
    expect(result).toHaveLength(0);
  });

  it('matches engineer roles', () => {
    const result = filterByRole(members, 'engineer');
    expect(result.some((m) => m.name === 'Diana')).toBe(true);
  });

  it('matches "Vice President of Engineering" against VP Engineering target', () => {
    const vps = [{ name: 'Test', role: 'Vice President of Engineering' }];
    const result = filterByRole(vps, 'VP Engineering');
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Adapter properties
// ---------------------------------------------------------------------------

describe('directoryScraper adapter properties', () => {
  it('has correct name', () => {
    expect(directoryScraper.name).toBe('directory_scrape');
  });

  it('has discovery capability', () => {
    expect(directoryScraper.capabilities).toEqual(['discovery']);
  });

  it('isEnabled returns true by default', () => {
    delete process.env.DIRECTORY_SCRAPING_ENABLED;
    expect(directoryScraper.isEnabled()).toBe(true);
  });

  it('isEnabled returns false when env var is false', () => {
    process.env.DIRECTORY_SCRAPING_ENABLED = 'false';
    expect(directoryScraper.isEnabled()).toBe(false);
    delete process.env.DIRECTORY_SCRAPING_ENABLED;
  });

  it('isEnabled returns true when env var is true', () => {
    process.env.DIRECTORY_SCRAPING_ENABLED = 'true';
    expect(directoryScraper.isEnabled()).toBe(true);
    delete process.env.DIRECTORY_SCRAPING_ENABLED;
  });
});

// ---------------------------------------------------------------------------
// discover() integration tests
// ---------------------------------------------------------------------------

describe('directoryScraper.discover', () => {
  beforeEach(() => {
    delete process.env.DIRECTORY_SCRAPING_ENABLED;
  });

  it('returns empty array when disabled', async () => {
    process.env.DIRECTORY_SCRAPING_ENABLED = 'false';
    const queries = [
      { query: 'https://www.crunchbase.com/organization/acme', vector: 'directory' as const },
    ];
    const results = await directoryScraper.discover!(queries, mockIcp);
    expect(results).toEqual([]);
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it('returns empty array when no directory URLs in queries', async () => {
    const queries = [{ query: 'site:linkedin.com/in CTO', vector: 'linkedin' as const }];
    const results = await directoryScraper.discover!(queries, mockIcp);
    expect(results).toEqual([]);
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it('returns empty array when directory queries have non-directory URLs', async () => {
    const queries = [
      { query: 'https://example.com/not-a-directory', vector: 'directory' as const },
    ];
    const results = await directoryScraper.discover!(queries, mockIcp);
    expect(results).toEqual([]);
  });

  it('launches browser and closes it after discovery', async () => {
    const crunchbaseData = {
      companyName: 'Acme Corp',
      description: 'A tech company',
      industry: 'SaaS',
      employeeCount: '50',
      fundingStage: 'Series A',
      teamMembers: [{ name: 'Alice', role: 'CTO' }],
    };
    vi.mocked(createPage).mockResolvedValue(makeMockPage(crunchbaseData) as any);

    const queries = [
      { query: 'https://www.crunchbase.com/organization/acme', vector: 'directory' as const },
    ];
    await directoryScraper.discover!(queries, mockIcp);
    expect(launchBrowser).toHaveBeenCalledOnce();
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it('acquires rate limit permit for each URL', async () => {
    vi.mocked(createPage).mockResolvedValue(
      makeMockPage({
        companyName: 'Acme',
        description: '',
        industry: '',
        employeeCount: '',
        fundingStage: '',
        teamMembers: [],
      }) as any,
    );

    const queries = [
      { query: 'https://www.crunchbase.com/organization/acme', vector: 'directory' as const },
      { query: 'https://www.crunchbase.com/organization/beta', vector: 'directory' as const },
    ];
    await directoryScraper.discover!(queries, mockIcp);
    expect(acquirePermit).toHaveBeenCalledTimes(2);
    expect(acquirePermit).toHaveBeenCalledWith('directory');
  });

  it('extracts Crunchbase leads with role filtering', async () => {
    const crunchbaseData = {
      companyName: 'Acme Corp',
      description: 'A tech company',
      industry: 'SaaS',
      employeeCount: '50',
      fundingStage: 'Series A',
      teamMembers: [
        { name: 'Alice', role: 'CTO' },
        { name: 'Bob', role: 'Marketing Manager' },
      ],
    };
    vi.mocked(createPage).mockResolvedValue(makeMockPage(crunchbaseData) as any);

    const queries = [
      { query: 'https://www.crunchbase.com/organization/acme', vector: 'directory' as const },
    ];
    const results = await directoryScraper.discover!(queries, mockIcp);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Alice');
    expect(results[0].role).toBe('CTO');
    expect(results[0].company).toBe('Acme Corp');
    expect(results[0].discoverySource).toBe('crunchbase_scrape');
  });

  it('extracts AngelList leads', async () => {
    const angelListData = {
      companyName: 'StartupCo',
      description: 'An AI startup',
      teamMembers: [{ name: 'Charlie', role: 'Chief Technology Officer' }],
    };
    vi.mocked(createPage).mockResolvedValue(makeMockPage(angelListData) as any);

    const queries = [
      { query: 'https://wellfound.com/company/startupco', vector: 'directory' as const },
    ];
    const results = await directoryScraper.discover!(queries, mockIcp);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Charlie');
    expect(results[0].company).toBe('StartupCo');
    expect(results[0].discoverySource).toBe('angellist_scrape');
  });

  it('extracts YC leads', async () => {
    const ycData = {
      companyName: 'YCStartup',
      batchYear: 'W24',
      description: 'A YC company',
      founders: [{ name: 'Diana', role: 'CTO & Co-Founder' }],
    };
    vi.mocked(createPage).mockResolvedValue(makeMockPage(ycData) as any);

    const queries = [
      { query: 'https://www.ycombinator.com/companies/ycstartup', vector: 'directory' as const },
    ];
    const results = await directoryScraper.discover!(queries, mockIcp);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Diana');
    expect(results[0].company).toBe('YCStartup');
    expect(results[0].discoverySource).toBe('yc_scrape');
  });

  it('handles CAPTCHA by returning empty for that URL', async () => {
    vi.mocked(detectCaptcha).mockResolvedValue(true);

    const queries = [
      { query: 'https://www.crunchbase.com/organization/acme', vector: 'directory' as const },
    ];
    const results = await directoryScraper.discover!(queries, mockIcp);
    expect(results).toEqual([]);
  });

  it('handles page errors gracefully and returns empty', async () => {
    vi.mocked(createPage).mockResolvedValue({
      goto: vi.fn().mockRejectedValue(new Error('Page load failed')),
      evaluate: vi.fn(),
      context: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
    } as any);

    const queries = [
      { query: 'https://www.crunchbase.com/organization/acme', vector: 'directory' as const },
    ];
    const results = await directoryScraper.discover!(queries, mockIcp);
    expect(results).toEqual([]);
  });

  it('closes browser even when errors occur', async () => {
    vi.mocked(createPage).mockRejectedValue(new Error('browser error'));

    const queries = [
      { query: 'https://www.crunchbase.com/organization/acme', vector: 'directory' as const },
    ];
    await directoryScraper.discover!(queries, mockIcp);
    expect(closeBrowser).toHaveBeenCalledOnce();
  });

  it('records requests after successful scrape', async () => {
    vi.mocked(createPage).mockResolvedValue(
      makeMockPage({
        companyName: 'Acme',
        description: '',
        industry: '',
        employeeCount: '',
        fundingStage: '',
        teamMembers: [],
      }) as any,
    );

    const queries = [
      { query: 'https://www.crunchbase.com/organization/acme', vector: 'directory' as const },
    ];
    await directoryScraper.discover!(queries, mockIcp);
    expect(recordRequest).toHaveBeenCalledWith('directory');
  });

  it('uses ICP industry as fallback when directory has no industry', async () => {
    const crunchbaseData = {
      companyName: 'Acme Corp',
      description: '',
      industry: '',
      employeeCount: '',
      fundingStage: '',
      teamMembers: [{ name: 'Alice', role: 'CTO' }],
    };
    vi.mocked(createPage).mockResolvedValue(makeMockPage(crunchbaseData) as any);

    const queries = [
      { query: 'https://www.crunchbase.com/organization/acme', vector: 'directory' as const },
    ];
    const results = await directoryScraper.discover!(queries, mockIcp);
    expect(results[0].industry).toBe('SaaS');
  });
});
