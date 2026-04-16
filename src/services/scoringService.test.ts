import type { ICP, ScoringInput } from '@/types';
import { describe, expect, it } from 'vitest';
import { calculateLeadScore } from './scoringService';

function makeICP(overrides: Partial<ICP> = {}): ICP {
  return {
    id: 'icp-1',
    founderId: 'founder-1',
    targetRole: 'CTO',
    industry: 'SaaS',
    geography: 'US',
    companyStage: 'Startup',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<ScoringInput['lead']> = {},
  icpOverrides: Partial<ICP> = {},
): ScoringInput {
  return {
    lead: {
      role: 'CTO',
      company: 'Acme Startup',
      industry: 'SaaS',
      geography: 'US',
      enrichmentData: {
        linkedinBio: 'Experienced tech leader',
        recentPosts: ['Post about AI'],
        companyInfo: 'Series A startup',
      },
      ...overrides,
    },
    icp: makeICP(icpOverrides),
  };
}

describe('calculateLeadScore', () => {
  it('returns totalScore in [1, 100]', () => {
    const result = calculateLeadScore(makeInput());
    expect(result.totalScore).toBeGreaterThanOrEqual(1);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it('breakdown sums to totalScore', () => {
    const result = calculateLeadScore(makeInput());
    const { icpMatch, roleRelevance, intentSignals } = result.breakdown;
    expect(icpMatch + roleRelevance + intentSignals).toBe(result.totalScore);
  });

  it('breakdown components are within valid ranges', () => {
    const result = calculateLeadScore(makeInput());
    expect(result.breakdown.icpMatch).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.icpMatch).toBeLessThanOrEqual(40);
    expect(result.breakdown.roleRelevance).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.roleRelevance).toBeLessThanOrEqual(30);
    expect(result.breakdown.intentSignals).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.intentSignals).toBeLessThanOrEqual(30);
  });

  it('gives maximum icpMatch when industry and geography match', () => {
    const result = calculateLeadScore(makeInput({ industry: 'SaaS', geography: 'US' }));
    // industry (20) + geography (12) = 32, plus possible company stage
    expect(result.breakdown.icpMatch).toBeGreaterThanOrEqual(32);
  });

  it('gives 0 icpMatch when nothing matches', () => {
    const result = calculateLeadScore(
      makeInput({ industry: 'Healthcare', geography: 'EU', company: 'BigCorp' }),
    );
    expect(result.breakdown.icpMatch).toBe(0);
  });

  it('gives 30 roleRelevance for exact role match', () => {
    const result = calculateLeadScore(makeInput({ role: 'CTO' }));
    expect(result.breakdown.roleRelevance).toBe(30);
  });

  it('gives partial roleRelevance for related role', () => {
    const result = calculateLeadScore(makeInput({ role: 'VP of CTO Operations' }));
    expect(result.breakdown.roleRelevance).toBeGreaterThan(0);
    expect(result.breakdown.roleRelevance).toBeLessThan(30);
  });

  it('gives 0 roleRelevance for unrelated role', () => {
    const result = calculateLeadScore(makeInput({ role: 'Designer' }));
    expect(result.breakdown.roleRelevance).toBe(0);
  });

  it('gives 30 intentSignals when all enrichment data present', () => {
    const result = calculateLeadScore(
      makeInput({
        enrichmentData: {
          linkedinBio: 'Bio',
          recentPosts: ['Post'],
          companyInfo: 'Info',
        },
      }),
    );
    expect(result.breakdown.intentSignals).toBe(30);
  });

  it('gives 0 intentSignals when no enrichment data', () => {
    const result = calculateLeadScore(makeInput({ enrichmentData: undefined }));
    expect(result.breakdown.intentSignals).toBe(0);
  });

  it('gives partial intentSignals for partial enrichment', () => {
    const result = calculateLeadScore(
      makeInput({
        enrichmentData: { linkedinBio: 'Bio' },
      }),
    );
    expect(result.breakdown.intentSignals).toBe(10);
  });

  it('clamps minimum totalScore to 1 even when all components are 0', () => {
    const result = calculateLeadScore(
      makeInput(
        {
          role: 'Designer',
          industry: 'Healthcare',
          geography: 'EU',
          company: 'BigCorp',
          enrichmentData: undefined,
        },
        { targetRole: 'CTO', industry: 'SaaS', geography: 'US' },
      ),
    );
    expect(result.totalScore).toBeGreaterThanOrEqual(1);
    const { icpMatch, roleRelevance, intentSignals } = result.breakdown;
    expect(icpMatch + roleRelevance + intentSignals).toBe(result.totalScore);
  });

  it('handles empty strings in enrichment data as no data', () => {
    const result = calculateLeadScore(
      makeInput({
        enrichmentData: { linkedinBio: '', recentPosts: [], companyInfo: '  ' },
      }),
    );
    expect(result.breakdown.intentSignals).toBe(0);
  });

  it('is case-insensitive for industry matching', () => {
    const result = calculateLeadScore(makeInput({ industry: 'saas' }, { industry: 'SaaS' }));
    expect(result.breakdown.icpMatch).toBeGreaterThanOrEqual(20);
  });

  it('is case-insensitive for role matching', () => {
    const result = calculateLeadScore(makeInput({ role: 'cto' }, { targetRole: 'CTO' }));
    expect(result.breakdown.roleRelevance).toBe(30);
  });
});
