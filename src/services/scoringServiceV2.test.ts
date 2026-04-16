import type { ICPProfile, ScoringInputV2 } from '@/types';
import { describe, expect, it } from 'vitest';
import { calculateLeadScoreV2 } from './scoringService';

function makeProfile(overrides: Partial<ICPProfile> = {}): ICPProfile {
  return {
    id: 'profile-1',
    founderId: 'founder-1',
    targetRole: 'CTO',
    industry: 'SaaS',
    companyStage: 'Startup',
    geography: 'US',
    painPoints: ['slow deployment pipelines', 'lack of code review automation'],
    buyingSignals: ['hiring devops engineers'],
    customTags: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeInputV2(
  leadOverrides: Partial<ScoringInputV2['lead']> = {},
  profileOverrides: Partial<ICPProfile> = {},
): ScoringInputV2 {
  return {
    lead: {
      role: 'CTO',
      company: 'Acme Startup',
      industry: 'SaaS',
      geography: 'US',
      enrichmentData: {
        linkedinBio: 'Experienced tech leader focused on deployment and automation',
        recentPosts: ['We need better code review tools'],
        companyInfo: 'Series A startup building developer tools',
      },
      ...leadOverrides,
    },
    icpProfile: makeProfile(profileOverrides),
  };
}

describe('calculateLeadScoreV2', () => {
  it('returns totalScore in [1, 100]', () => {
    const result = calculateLeadScoreV2(makeInputV2());
    expect(result.totalScore).toBeGreaterThanOrEqual(1);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it('breakdown sums to totalScore', () => {
    const result = calculateLeadScoreV2(makeInputV2());
    const { icpMatch, roleRelevance, intentSignals, painPointRelevance } = result.breakdown;
    expect(icpMatch + roleRelevance + intentSignals + painPointRelevance).toBe(result.totalScore);
  });

  it('breakdown components are within valid ranges', () => {
    const result = calculateLeadScoreV2(makeInputV2());
    expect(result.breakdown.icpMatch).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.icpMatch).toBeLessThanOrEqual(25);
    expect(result.breakdown.roleRelevance).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.roleRelevance).toBeLessThanOrEqual(25);
    expect(result.breakdown.intentSignals).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.intentSignals).toBeLessThanOrEqual(30);
    expect(result.breakdown.painPointRelevance).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.painPointRelevance).toBeLessThanOrEqual(20);
  });

  // --- icpMatch V2 (0–25) ---

  it('gives icpMatch points when industry and geography match', () => {
    const result = calculateLeadScoreV2(makeInputV2({ industry: 'SaaS', geography: 'US' }));
    // industry (12) + geography (8) = 20, plus possible company stage
    expect(result.breakdown.icpMatch).toBeGreaterThanOrEqual(20);
  });

  it('gives 0 icpMatch when nothing matches', () => {
    const result = calculateLeadScoreV2(
      makeInputV2({ industry: 'Healthcare', geography: 'EU', company: 'BigCorp' }),
    );
    expect(result.breakdown.icpMatch).toBe(0);
  });

  // --- roleRelevance V2 (0–25) ---

  it('gives 25 roleRelevance for exact role match', () => {
    const result = calculateLeadScoreV2(makeInputV2({ role: 'CTO' }));
    expect(result.breakdown.roleRelevance).toBe(25);
  });

  it('gives 0 roleRelevance for unrelated role', () => {
    const result = calculateLeadScoreV2(makeInputV2({ role: 'Designer' }));
    expect(result.breakdown.roleRelevance).toBe(0);
  });

  // --- intentSignals (0–30, reused from V1) ---

  it('gives 30 intentSignals when all enrichment data present', () => {
    const result = calculateLeadScoreV2(
      makeInputV2({
        enrichmentData: {
          linkedinBio: 'Bio text',
          recentPosts: ['Post about tech'],
          companyInfo: 'Company info text',
        },
      }),
    );
    expect(result.breakdown.intentSignals).toBe(30);
  });

  it('gives 0 intentSignals when no enrichment data', () => {
    const result = calculateLeadScoreV2(makeInputV2({ enrichmentData: undefined }));
    expect(result.breakdown.intentSignals).toBe(0);
  });

  // --- painPointRelevance (0–20) ---

  it('gives painPointRelevance > 0 when enrichment data mentions pain points', () => {
    const result = calculateLeadScoreV2(
      makeInputV2(
        {
          enrichmentData: {
            linkedinBio: 'Working on improving deployment pipelines and code review processes',
            recentPosts: [],
            companyInfo: '',
          },
        },
        { painPoints: ['slow deployment pipelines', 'lack of code review automation'] },
      ),
    );
    expect(result.breakdown.painPointRelevance).toBeGreaterThan(0);
  });

  it('gives 0 painPointRelevance when no enrichment data', () => {
    const result = calculateLeadScoreV2(makeInputV2({ enrichmentData: undefined }));
    expect(result.breakdown.painPointRelevance).toBe(0);
  });

  it('gives 0 painPointRelevance when enrichment data has no pain point matches', () => {
    const result = calculateLeadScoreV2(
      makeInputV2(
        {
          enrichmentData: {
            linkedinBio: 'Marketing expert focused on brand strategy',
            recentPosts: ['Great quarter for sales'],
            companyInfo: 'Consumer goods company',
          },
        },
        { painPoints: ['slow deployment pipelines', 'lack of code review automation'] },
      ),
    );
    expect(result.breakdown.painPointRelevance).toBe(0);
  });

  it('gives 0 painPointRelevance when profile has empty painPoints', () => {
    const result = calculateLeadScoreV2(makeInputV2({}, { painPoints: [] }));
    expect(result.breakdown.painPointRelevance).toBe(0);
  });

  it('gives max painPointRelevance (20) when all pain points match', () => {
    const result = calculateLeadScoreV2(
      makeInputV2(
        {
          enrichmentData: {
            linkedinBio: 'deployment pipelines automation code review',
            recentPosts: [],
            companyInfo: '',
          },
        },
        { painPoints: ['deployment pipelines', 'code review'] },
      ),
    );
    expect(result.breakdown.painPointRelevance).toBe(20);
  });

  // --- Clamping and edge cases ---

  it('clamps minimum totalScore to 1 even when all components are 0', () => {
    const result = calculateLeadScoreV2(
      makeInputV2(
        {
          role: 'Designer',
          industry: 'Healthcare',
          geography: 'EU',
          company: 'BigCorp',
          enrichmentData: undefined,
        },
        { targetRole: 'CTO', industry: 'SaaS', geography: 'US', painPoints: ['deployment'] },
      ),
    );
    expect(result.totalScore).toBeGreaterThanOrEqual(1);
    const { icpMatch, roleRelevance, intentSignals, painPointRelevance } = result.breakdown;
    expect(icpMatch + roleRelevance + intentSignals + painPointRelevance).toBe(result.totalScore);
  });

  it('is case-insensitive for pain point matching', () => {
    const result = calculateLeadScoreV2(
      makeInputV2(
        {
          enrichmentData: {
            linkedinBio: 'DEPLOYMENT PIPELINES are critical',
            recentPosts: [],
            companyInfo: '',
          },
        },
        { painPoints: ['deployment pipelines'] },
      ),
    );
    expect(result.breakdown.painPointRelevance).toBeGreaterThan(0);
  });

  it('searches across all enrichment fields for pain point matches', () => {
    const result = calculateLeadScoreV2(
      makeInputV2(
        {
          enrichmentData: {
            linkedinBio: '',
            recentPosts: ['Our deployment pipeline is too slow'],
            companyInfo: 'Company focused on code review tools',
          },
        },
        { painPoints: ['slow deployment pipeline', 'code review tools'] },
      ),
    );
    expect(result.breakdown.painPointRelevance).toBeGreaterThan(0);
  });
});
