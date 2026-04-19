import { describe, expect, it } from 'vitest';
import { mergeEnrichmentWithExisting } from './enrichmentPipeline';
import type { ExtendedEnrichmentData } from './types';

describe('mergeEnrichmentWithExisting', () => {
  it('returns existing data unchanged when new data is empty', () => {
    const existing: Partial<ExtendedEnrichmentData> = {
      linkedinBio: 'Senior Engineer at Acme',
      email: 'john@acme.com',
      companyInfo: 'Acme Corp',
    };
    const result = mergeEnrichmentWithExisting(existing, {});
    expect(result.linkedinBio).toBe('Senior Engineer at Acme');
    expect(result.email).toBe('john@acme.com');
    expect(result.companyInfo).toBe('Acme Corp');
  });

  it('new non-empty string fields override existing values', () => {
    const existing: Partial<ExtendedEnrichmentData> = {
      email: 'old@acme.com',
      companyInfo: 'Old Info',
    };
    const newData: Partial<ExtendedEnrichmentData> = {
      email: 'new@acme.com',
      companyInfo: 'New Info',
    };
    const result = mergeEnrichmentWithExisting(existing, newData);
    expect(result.email).toBe('new@acme.com');
    expect(result.companyInfo).toBe('New Info');
  });

  it('preserves existing non-empty fields when new data provides empty/null', () => {
    const existing: Partial<ExtendedEnrichmentData> = {
      linkedinBio: 'Has a bio',
      email: 'keep@acme.com',
      companyDomain: 'acme.com',
    };
    const newData: Partial<ExtendedEnrichmentData> = {
      linkedinBio: '',
      email: undefined,
      companyDomain: '  ',
    };
    const result = mergeEnrichmentWithExisting(existing, newData);
    expect(result.linkedinBio).toBe('Has a bio');
    expect(result.email).toBe('keep@acme.com');
    expect(result.companyDomain).toBe('acme.com');
  });

  it('merges and deduplicates array fields', () => {
    const existing: Partial<ExtendedEnrichmentData> = {
      dataSources: ['linkedin_scrape', 'github_scrape'],
      recentPosts: ['Post A'],
    };
    const newData: Partial<ExtendedEnrichmentData> = {
      dataSources: ['github_scrape', 'hunter_api'],
      recentPosts: ['Post A', 'Post B'],
    };
    const result = mergeEnrichmentWithExisting(existing, newData);
    expect(result.dataSources).toEqual(['linkedin_scrape', 'github_scrape', 'hunter_api']);
    expect(result.recentPosts).toEqual(['Post A', 'Post B']);
  });

  it('preserves existing arrays when new data has empty arrays', () => {
    const existing: Partial<ExtendedEnrichmentData> = {
      dataSources: ['linkedin_scrape'],
      recentPosts: ['Post A'],
    };
    const newData: Partial<ExtendedEnrichmentData> = {
      dataSources: [],
      recentPosts: undefined,
    };
    const result = mergeEnrichmentWithExisting(existing, newData);
    expect(result.dataSources).toEqual(['linkedin_scrape']);
    expect(result.recentPosts).toEqual(['Post A']);
  });

  it('takes higher dataConfidenceScore', () => {
    const existing: Partial<ExtendedEnrichmentData> = { dataConfidenceScore: 0.8 };
    const newData: Partial<ExtendedEnrichmentData> = { dataConfidenceScore: 0.6 };
    const result = mergeEnrichmentWithExisting(existing, newData);
    expect(result.dataConfidenceScore).toBe(0.8);

    const result2 = mergeEnrichmentWithExisting(
      { dataConfidenceScore: 0.4 },
      { dataConfidenceScore: 0.9 },
    );
    expect(result2.dataConfidenceScore).toBe(0.9);
  });

  it('new emailVerified overrides existing when defined', () => {
    const existing: Partial<ExtendedEnrichmentData> = { emailVerified: false };
    const newData: Partial<ExtendedEnrichmentData> = { emailVerified: true };
    const result = mergeEnrichmentWithExisting(existing, newData);
    expect(result.emailVerified).toBe(true);
  });

  it('preserves existing emailVerified when new is undefined', () => {
    const existing: Partial<ExtendedEnrichmentData> = { emailVerified: true };
    const result = mergeEnrichmentWithExisting(existing, {});
    expect(result.emailVerified).toBe(true);
  });

  it('takes more recent lastVerifiedAt', () => {
    const older = new Date('2024-01-01');
    const newer = new Date('2024-06-01');
    const result = mergeEnrichmentWithExisting(
      { lastVerifiedAt: newer },
      { lastVerifiedAt: older },
    );
    expect(result.lastVerifiedAt).toEqual(newer);

    const result2 = mergeEnrichmentWithExisting(
      { lastVerifiedAt: older },
      { lastVerifiedAt: newer },
    );
    expect(result2.lastVerifiedAt).toEqual(newer);
  });

  it('no previously populated field becomes empty after merge', () => {
    const existing: Partial<ExtendedEnrichmentData> = {
      linkedinBio: 'Bio text',
      email: 'test@example.com',
      companyInfo: 'Company info',
      dataSources: ['source1'],
      recentPosts: ['post1'],
      emailVerified: true,
      dataConfidenceScore: 0.7,
      lastVerifiedAt: new Date('2024-01-01'),
    };
    // Merge with all-empty new data
    const newData: Partial<ExtendedEnrichmentData> = {
      linkedinBio: '',
      email: undefined,
      companyInfo: null as unknown as string,
      dataSources: [],
      recentPosts: [],
    };
    const result = mergeEnrichmentWithExisting(existing, newData);

    // Every previously populated field must still be populated
    expect(result.linkedinBio).toBe('Bio text');
    expect(result.email).toBe('test@example.com');
    expect(result.companyInfo).toBe('Company info');
    expect(result.dataSources).toEqual(['source1']);
    expect(result.recentPosts).toEqual(['post1']);
    expect(result.emailVerified).toBe(true);
    expect(result.dataConfidenceScore).toBe(0.7);
    expect(result.lastVerifiedAt).toEqual(new Date('2024-01-01'));
  });
});
