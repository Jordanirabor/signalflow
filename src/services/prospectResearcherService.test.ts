import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database module before importing the service
vi.mock('@/lib/db', () => {
  return {
    query: vi.fn(),
    default: {},
  };
});

// Mock the discovery source adapters so the service module loads without real dependencies
vi.mock('./discovery/linkedinScraper', () => ({
  linkedinScraper: { name: 'linkedin_scrape', enrich: vi.fn().mockResolvedValue({}) },
}));
vi.mock('./discovery/twitterScraper', () => ({
  twitterScraper: {
    name: 'twitter_scrape',
    capabilities: ['discovery', 'enrichment'],
    enrich: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('./discovery/newsScraper', () => ({
  newsScraper: { name: 'news_scrape', enrich: vi.fn().mockResolvedValue({}) },
}));
vi.mock('./discovery/companyWebsiteScraper', () => ({
  companyWebsiteScraper: { name: 'company_website_scrape', enrich: vi.fn().mockResolvedValue({}) },
}));
vi.mock('./discovery/rateLimiter', () => ({
  acquirePermit: vi.fn().mockResolvedValue(undefined),
  recordRequest: vi.fn(),
}));
vi.mock('./discovery/healthMonitor', () => ({
  isSourceAvailable: vi.fn().mockReturnValue(true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

import { query } from '@/lib/db';
import type { Lead, ResearchProfile } from '@/types';
import {
  getResearchProfile,
  isResearchStale,
  mergeResearchResults,
  researchProspect,
  type ResearchSourceAdapter,
} from './prospectResearcherService';

const mockedQuery = vi.mocked(query);

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    founderId: 'founder-1',
    name: 'Jane Doe',
    role: 'CTO',
    company: 'Acme Corp',
    leadScore: 75,
    scoreBreakdown: { icpMatch: 30, roleRelevance: 25, intentSignals: 20 },
    enrichmentStatus: 'pending',
    crmStatus: 'New',
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });
});

describe('mergeResearchResults', () => {
  it('merges partial results from multiple adapters', () => {
    const results = [
      {
        adapterName: 'linkedin',
        data: {
          topicsOfInterest: ['AI', 'ML'],
          recentActivity: [
            { summary: 'Posted about AI', source: 'linkedin', timestamp: new Date() },
          ],
        },
      },
      {
        adapterName: 'news',
        data: {
          recentActivity: [
            { summary: 'Featured in TechCrunch', source: 'news', timestamp: new Date() },
          ],
          publishedContentSummaries: ['TechCrunch article about Acme'],
        },
      },
    ];

    const profile = mergeResearchResults('lead-1', results, ['twitter']);

    expect(profile.leadId).toBe('lead-1');
    expect(profile.topicsOfInterest).toEqual(['AI', 'ML']);
    expect(profile.recentActivity).toHaveLength(2);
    expect(profile.publishedContentSummaries).toEqual(['TechCrunch article about Acme']);
    expect(profile.sourcesUsed).toEqual(['linkedin', 'news']);
    expect(profile.sourcesUnavailable).toEqual(['twitter']);
    expect(profile.overallSentiment).toBe('neutral');
    expect(profile.researchedAt).toBeInstanceOf(Date);
  });

  it('deduplicates topics and summaries', () => {
    const results = [
      { adapterName: 'a', data: { topicsOfInterest: ['AI', 'ML'] } },
      { adapterName: 'b', data: { topicsOfInterest: ['AI', 'Cloud'] } },
    ];

    const profile = mergeResearchResults('lead-1', results, []);
    expect(profile.topicsOfInterest).toEqual(['AI', 'ML', 'Cloud']);
  });

  it('returns empty lists when no data is provided', () => {
    const profile = mergeResearchResults('lead-1', [], ['linkedin', 'twitter']);

    expect(profile.topicsOfInterest).toEqual([]);
    expect(profile.currentChallenges).toEqual([]);
    expect(profile.recentActivity).toEqual([]);
    expect(profile.publishedContentSummaries).toEqual([]);
    expect(profile.sourcesUsed).toEqual([]);
    expect(profile.sourcesUnavailable).toEqual(['linkedin', 'twitter']);
  });
});

describe('researchProspect', () => {
  it('executes adapters concurrently and merges results', async () => {
    const adapter1: ResearchSourceAdapter = {
      name: 'test_source_1',
      fetch: vi.fn().mockResolvedValue({
        topicsOfInterest: ['Topic A'],
        recentActivity: [{ summary: 'Activity 1', source: 'test_source_1', timestamp: new Date() }],
      }),
    };
    const adapter2: ResearchSourceAdapter = {
      name: 'test_source_2',
      fetch: vi.fn().mockResolvedValue({
        currentChallenges: ['Challenge 1'],
      }),
    };

    const lead = makeLead();
    const profile = await researchProspect(lead, [adapter1, adapter2]);

    expect(profile.topicsOfInterest).toEqual(['Topic A']);
    expect(profile.currentChallenges).toEqual(['Challenge 1']);
    expect(profile.sourcesUsed).toContain('test_source_1');
    expect(profile.sourcesUsed).toContain('test_source_2');
    expect(profile.sourcesUnavailable).toEqual([]);

    // Should have set status to 'researching' then 'complete'
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('enrichment_status'), [
      'researching',
      lead.id,
    ]);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('enrichment_status'), [
      'complete',
      lead.id,
    ]);
  });

  it('records failed adapters in sourcesUnavailable', async () => {
    const successAdapter: ResearchSourceAdapter = {
      name: 'success_source',
      fetch: vi.fn().mockResolvedValue({
        topicsOfInterest: ['Topic'],
      }),
    };
    const failAdapter: ResearchSourceAdapter = {
      name: 'fail_source',
      fetch: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    const lead = makeLead();
    const profile = await researchProspect(lead, [successAdapter, failAdapter]);

    expect(profile.sourcesUsed).toEqual(['success_source']);
    expect(profile.sourcesUnavailable).toEqual(['fail_source']);
  });

  it('sets status to partial when all adapters fail', async () => {
    const failAdapter: ResearchSourceAdapter = {
      name: 'fail_source',
      fetch: vi.fn().mockRejectedValue(new Error('Timeout')),
    };

    const lead = makeLead();
    const profile = await researchProspect(lead, [failAdapter]);

    expect(profile.sourcesUnavailable).toEqual(['fail_source']);
    expect(profile.sourcesUsed).toEqual([]);

    // Should set status to 'partial'
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('enrichment_status'), [
      'partial',
      lead.id,
    ]);
  });

  it('records adapters returning empty data as unavailable', async () => {
    const emptyAdapter: ResearchSourceAdapter = {
      name: 'empty_source',
      fetch: vi.fn().mockResolvedValue({}),
    };

    const lead = makeLead();
    const profile = await researchProspect(lead, [emptyAdapter]);

    expect(profile.sourcesUnavailable).toEqual(['empty_source']);
    expect(profile.sourcesUsed).toEqual([]);
  });

  it('stores the research profile in the database', async () => {
    const adapter: ResearchSourceAdapter = {
      name: 'test_source',
      fetch: vi.fn().mockResolvedValue({
        topicsOfInterest: ['Topic'],
      }),
    };

    const lead = makeLead();
    await researchProspect(lead, [adapter]);

    // Should have called query to store research_profile
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('research_profile'), [
      expect.any(String),
      lead.id,
    ]);
  });
});

describe('getResearchProfile', () => {
  it('returns null when no lead is found', async () => {
    mockedQuery.mockResolvedValue({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });

    const result = await getResearchProfile('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when research_profile is null', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ research_profile: null }],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await getResearchProfile('lead-1');
    expect(result).toBeNull();
  });

  it('returns deserialized profile with proper Date objects', async () => {
    const storedProfile = {
      leadId: 'lead-1',
      topicsOfInterest: ['AI'],
      currentChallenges: ['Scaling'],
      recentActivity: [
        { summary: 'Post', source: 'linkedin', timestamp: '2024-01-15T00:00:00.000Z' },
      ],
      publishedContentSummaries: ['Article'],
      overallSentiment: 'positive',
      sourcesUsed: ['linkedin'],
      sourcesUnavailable: [],
      researchedAt: '2024-01-15T00:00:00.000Z',
    };

    mockedQuery.mockResolvedValue({
      rows: [{ research_profile: storedProfile }],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await getResearchProfile('lead-1');

    expect(result).not.toBeNull();
    expect(result!.researchedAt).toBeInstanceOf(Date);
    expect(result!.recentActivity[0].timestamp).toBeInstanceOf(Date);
    expect(result!.topicsOfInterest).toEqual(['AI']);
  });
});

describe('isResearchStale', () => {
  it('returns true when research is older than threshold', () => {
    const profile: ResearchProfile = {
      leadId: 'lead-1',
      topicsOfInterest: [],
      currentChallenges: [],
      recentActivity: [],
      publishedContentSummaries: [],
      overallSentiment: 'neutral',
      sourcesUsed: [],
      sourcesUnavailable: [],
      researchedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
    };

    expect(isResearchStale(profile, 7)).toBe(true);
  });

  it('returns false when research is within threshold', () => {
    const profile: ResearchProfile = {
      leadId: 'lead-1',
      topicsOfInterest: [],
      currentChallenges: [],
      recentActivity: [],
      publishedContentSummaries: [],
      overallSentiment: 'neutral',
      sourcesUsed: [],
      sourcesUnavailable: [],
      researchedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    };

    expect(isResearchStale(profile, 7)).toBe(false);
  });

  it('returns false when research was just done', () => {
    const profile: ResearchProfile = {
      leadId: 'lead-1',
      topicsOfInterest: [],
      currentChallenges: [],
      recentActivity: [],
      publishedContentSummaries: [],
      overallSentiment: 'neutral',
      sourcesUsed: [],
      sourcesUnavailable: [],
      researchedAt: new Date(),
    };

    expect(isResearchStale(profile, 7)).toBe(false);
  });

  it('returns true when threshold is 0 and research is not from the future', () => {
    const profile: ResearchProfile = {
      leadId: 'lead-1',
      topicsOfInterest: [],
      currentChallenges: [],
      recentActivity: [],
      publishedContentSummaries: [],
      overallSentiment: 'neutral',
      sourcesUsed: [],
      sourcesUnavailable: [],
      researchedAt: new Date(Date.now() - 1000), // 1 second ago
    };

    expect(isResearchStale(profile, 0)).toBe(true);
  });
});
