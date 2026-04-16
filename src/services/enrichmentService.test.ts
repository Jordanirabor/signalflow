import { vi } from 'vitest';

// Mock the discovery engine and enrichment pipeline modules
vi.mock('./discovery/discoveryEngine', () => ({
  discoverLeads: vi.fn(),
}));
vi.mock('./discovery/enrichmentPipeline', () => ({
  enrichProspect: vi.fn(),
}));
vi.mock('./discovery/runCache', () => ({
  createRunCache: vi.fn(() => ({
    getCompanyData: vi.fn(),
    setCompanyData: vi.fn(),
    getMXRecords: vi.fn(),
    setMXRecords: vi.fn(),
    getEmailPattern: vi.fn(),
    setEmailPattern: vi.fn(),
    clear: vi.fn(),
  })),
}));

import { beforeEach, describe, expect, it } from 'vitest';
import { discoverLeads as discoveryEngineDiscover } from './discovery/discoveryEngine';
import { enrichProspect } from './discovery/enrichmentPipeline';
import { discoverLeads, enrichLead } from './enrichmentService';

const mockedDiscoveryEngine = vi.mocked(discoveryEngineDiscover);
const mockedEnrichProspect = vi.mocked(enrichProspect);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrichLead', () => {
  it('delegates to enrichProspect and returns EnrichmentResult', async () => {
    mockedEnrichProspect.mockResolvedValue({
      enrichmentData: {
        linkedinBio: 'Bio text',
        recentPosts: ['Post 1'],
        companyInfo: 'Company info',
        dataSources: ['linkedin_scrape'],
      },
      enrichmentStatus: 'complete',
    });

    const result = await enrichLead('Alice', 'Acme');

    expect(mockedEnrichProspect).toHaveBeenCalledWith(
      { name: 'Alice', company: 'Acme' },
      expect.any(Object),
    );
    expect(result.enrichmentStatus).toBe('complete');
    expect(result.enrichmentData.linkedinBio).toBe('Bio text');
    expect(result.enrichmentData.recentPosts).toEqual(['Post 1']);
    expect(result.enrichmentData.companyInfo).toBe('Company info');
  });

  it('returns partial status from enrichment pipeline', async () => {
    mockedEnrichProspect.mockResolvedValue({
      enrichmentData: {
        linkedinBio: 'Bio text',
        failedSources: ['news_scrape'],
        dataSources: ['linkedin_scrape'],
      },
      enrichmentStatus: 'partial',
    });

    const result = await enrichLead('Alice', 'Acme');

    expect(result.enrichmentStatus).toBe('partial');
    expect(result.enrichmentData.failedSources).toEqual(['news_scrape']);
  });

  it('returns pending status when all sources fail', async () => {
    mockedEnrichProspect.mockResolvedValue({
      enrichmentData: {
        failedSources: ['linkedin_scrape', 'news_scrape'],
        dataSources: [],
      },
      enrichmentStatus: 'pending',
    });

    const result = await enrichLead('Alice', 'Acme');

    expect(result.enrichmentStatus).toBe('pending');
    expect(result.enrichmentData.failedSources).toEqual(['linkedin_scrape', 'news_scrape']);
  });

  it('ignores the optional sources parameter (backward compat signature)', async () => {
    mockedEnrichProspect.mockResolvedValue({
      enrichmentData: { linkedinBio: 'Bio' },
      enrichmentStatus: 'complete',
    });

    // The third parameter (sources) is accepted but ignored
    const result = await enrichLead('Alice', 'Acme', []);

    expect(result.enrichmentStatus).toBe('complete');
    expect(mockedEnrichProspect).toHaveBeenCalled();
  });
});

describe('discoverLeads', () => {
  it('delegates to the Discovery Engine and returns results', async () => {
    const mockResults = [
      {
        name: 'Jordan Smith',
        role: 'CTO',
        company: 'SaaS Innovations',
        industry: 'SaaS',
        geography: 'US',
        discoverySource: 'google_search',
      },
      {
        name: 'Taylor Chen',
        role: 'CTO',
        company: 'SaaS Solutions',
        industry: 'SaaS',
        geography: 'US',
        discoverySource: 'linkedin_scrape',
      },
    ];
    mockedDiscoveryEngine.mockResolvedValue(mockResults);

    const mockICP = {
      id: 'icp-1',
      founderId: 'founder-1',
      targetRole: 'CTO',
      industry: 'SaaS',
      geography: 'US',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const leads = await discoverLeads(mockICP);

    expect(mockedDiscoveryEngine).toHaveBeenCalledWith(mockICP);
    expect(leads).toHaveLength(2);
    expect(leads[0].name).toBe('Jordan Smith');
    expect(leads[1].name).toBe('Taylor Chen');
  });

  it('returns empty array when Discovery Engine returns empty', async () => {
    mockedDiscoveryEngine.mockResolvedValue([]);

    const mockICP = {
      id: 'icp-1',
      founderId: 'founder-1',
      targetRole: 'CTO',
      industry: 'SaaS',
      geography: 'US',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const leads = await discoverLeads(mockICP);

    expect(leads).toEqual([]);
  });

  it('returns leads with required fields populated', async () => {
    mockedDiscoveryEngine.mockResolvedValue([
      {
        name: 'Test Lead',
        role: 'CTO',
        company: 'Test Co',
        industry: 'SaaS',
        geography: 'US',
        discoverySource: 'google_search',
      },
    ]);

    const mockICP = {
      id: 'icp-1',
      founderId: 'founder-1',
      targetRole: 'CTO',
      industry: 'SaaS',
      geography: 'US',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const leads = await discoverLeads(mockICP);

    for (const lead of leads) {
      expect(lead.name).toBeTruthy();
      expect(lead.role).toBeTruthy();
      expect(lead.company).toBeTruthy();
    }
  });
});
