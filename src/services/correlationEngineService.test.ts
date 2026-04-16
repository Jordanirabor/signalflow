import { describe, expect, it, vi } from 'vitest';

// Mock external dependencies before importing the service
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  default: {},
}));

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: { create: vi.fn() },
    })),
  };
});

import type {
  CorrelationBreakdown,
  EnrichedICP,
  Lead,
  ResearchActivity,
  ResearchProfile,
} from '@/types';
import {
  clampScore,
  computeBuyingSignalStrength,
  computeCorrelationScore,
  computeIndustryAlignment,
  computePainPointOverlapKeywordFallback,
  computeRoleFit,
  computeWeightedTotal,
  CORRELATION_WEIGHTS,
  determineCorrelationFlag,
  setOpenAIClient,
} from './correlationEngineService';

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    founderId: 'founder-1',
    name: 'Jane Doe',
    role: 'CTO',
    company: 'Acme Corp',
    industry: 'SaaS',
    leadScore: 50,
    scoreBreakdown: { icpMatch: 20, roleRelevance: 15, intentSignals: 15 },
    enrichmentStatus: 'complete',
    crmStatus: 'New',
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeResearchProfile(overrides: Partial<ResearchProfile> = {}): ResearchProfile {
  return {
    leadId: 'lead-1',
    topicsOfInterest: ['cloud infrastructure', 'devops'],
    currentChallenges: ['scaling infrastructure', 'reducing deployment time'],
    recentActivity: [],
    publishedContentSummaries: [],
    overallSentiment: 'neutral',
    sourcesUsed: ['linkedin'],
    sourcesUnavailable: [],
    researchedAt: new Date(),
    ...overrides,
  };
}

function makeEnrichedICP(overrides: Partial<EnrichedICP> = {}): EnrichedICP {
  return {
    id: 'icp-1',
    founderId: 'founder-1',
    targetRole: 'CTO',
    industry: 'SaaS',
    createdAt: new Date(),
    updatedAt: new Date(),
    painPointsSolved: ['scaling infrastructure', 'deployment automation'],
    productDescription: 'Cloud deployment platform',
    valueProposition: 'Deploy 10x faster',
    ...overrides,
  };
}

function makeActivity(summary: string, daysAgo: number, source = 'linkedin'): ResearchActivity {
  const ts = new Date();
  ts.setDate(ts.getDate() - daysAgo);
  return { summary, source, timestamp: ts };
}

describe('clampScore', () => {
  it('returns 0.0 for NaN', () => expect(clampScore(NaN)).toBe(0.0));
  it('returns 0.0 for Infinity', () => expect(clampScore(Infinity)).toBe(0.0));
  it('returns 0.0 for -Infinity', () => expect(clampScore(-Infinity)).toBe(0.0));
  it('clamps negative values to 0.0', () => expect(clampScore(-0.5)).toBe(0.0));
  it('clamps values above 1.0 to 1.0', () => expect(clampScore(1.5)).toBe(1.0));
  it('passes through valid values', () => expect(clampScore(0.5)).toBe(0.5));
});

describe('computeRoleFit', () => {
  it('returns 1.0 for exact match', () => expect(computeRoleFit('CTO', 'CTO')).toBe(1.0));
  it('returns 1.0 for case-insensitive match', () =>
    expect(computeRoleFit('cto', 'CTO')).toBe(1.0));
  it('returns ~0.667 when one contains the other', () => {
    expect(computeRoleFit('VP of Engineering', 'Engineering')).toBeCloseTo(20 / 30, 2);
  });
  it('returns partial score for word overlap', () => {
    const score = computeRoleFit('Head of Engineering', 'VP Engineering');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1.0);
  });
  it('returns 0.0 for no match', () => expect(computeRoleFit('Designer', 'CTO')).toBe(0.0));
  it('returns 0.0 for empty strings', () => {
    expect(computeRoleFit('', 'CTO')).toBe(0.0);
    expect(computeRoleFit('CTO', '')).toBe(0.0);
  });
});

describe('computeIndustryAlignment', () => {
  it('returns 1.0 for exact match', () =>
    expect(computeIndustryAlignment('SaaS', 'SaaS')).toBe(1.0));
  it('returns 1.0 for case-insensitive match', () =>
    expect(computeIndustryAlignment('saas', 'SaaS')).toBe(1.0));
  it('returns 0.5 for partial match', () =>
    expect(computeIndustryAlignment('Enterprise SaaS', 'SaaS')).toBe(0.5));
  it('returns 0.5 for word overlap', () =>
    expect(computeIndustryAlignment('Financial Technology', 'Technology Services')).toBe(0.5));
  it('returns 0.0 for no match', () =>
    expect(computeIndustryAlignment('Healthcare', 'SaaS')).toBe(0.0));
  it('returns 0.0 for undefined', () =>
    expect(computeIndustryAlignment(undefined, 'SaaS')).toBe(0.0));
  it('returns 0.0 for empty strings', () => expect(computeIndustryAlignment('', 'SaaS')).toBe(0.0));
});

describe('computePainPointOverlapKeywordFallback', () => {
  it('returns 0.0 for empty challenges', () =>
    expect(computePainPointOverlapKeywordFallback([], ['scaling'])).toBe(0.0));
  it('returns 0.0 for empty pain points', () =>
    expect(computePainPointOverlapKeywordFallback(['scaling'], [])).toBe(0.0));
  it('returns 1.0 when all pain points overlap', () => {
    const score = computePainPointOverlapKeywordFallback(
      ['scaling infrastructure is hard', 'deployment takes too long'],
      ['scaling infrastructure', 'deployment automation'],
    );
    expect(score).toBe(1.0);
  });
  it('returns partial score for partial overlap', () => {
    const score = computePainPointOverlapKeywordFallback(
      ['scaling infrastructure'],
      ['scaling infrastructure', 'security compliance'],
    );
    expect(score).toBe(0.5);
  });
  it('returns 0.0 for no overlap', () => {
    expect(
      computePainPointOverlapKeywordFallback(['hiring engineers'], ['scaling infrastructure']),
    ).toBe(0.0);
  });
});

describe('computeBuyingSignalStrength', () => {
  it('returns 0.0 for empty activity', () => expect(computeBuyingSignalStrength([])).toBe(0.0));
  it('returns 0.0 for no buying signals', () => {
    expect(
      computeBuyingSignalStrength([makeActivity('Published a blog post about cooking', 5)]),
    ).toBe(0.0);
  });
  it('returns positive score for recent buying signal', () => {
    const score = computeBuyingSignalStrength([
      makeActivity('Evaluating new cloud deployment tools', 3),
    ]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1.0);
  });
  it('scores recent signals higher than old ones', () => {
    const recent = computeBuyingSignalStrength([
      makeActivity('Evaluating new tools for deployment', 2),
    ]);
    const old = computeBuyingSignalStrength([
      makeActivity('Evaluating new tools for deployment', 100),
    ]);
    expect(recent).toBeGreaterThan(old);
  });
  it('scores multiple signals higher than single', () => {
    const single = computeBuyingSignalStrength([makeActivity('Evaluating new tools', 3)]);
    const multi = computeBuyingSignalStrength([
      makeActivity('Evaluating new tools', 3),
      makeActivity('Comparing vendor pricing', 5),
    ]);
    expect(multi).toBeGreaterThan(single);
  });
});

describe('determineCorrelationFlag', () => {
  it('flags scores below 0.3 as low_correlation', () => {
    expect(determineCorrelationFlag(0.0)).toBe('low_correlation');
    expect(determineCorrelationFlag(0.29)).toBe('low_correlation');
  });
  it('does not flag scores >= 0.3', () => {
    expect(determineCorrelationFlag(0.3)).toBeNull();
    expect(determineCorrelationFlag(1.0)).toBeNull();
  });
});

describe('CORRELATION_WEIGHTS', () => {
  it('weights sum to 1.0', () => {
    const sum =
      CORRELATION_WEIGHTS.roleFit +
      CORRELATION_WEIGHTS.industryAlignment +
      CORRELATION_WEIGHTS.painPointOverlap +
      CORRELATION_WEIGHTS.buyingSignalStrength;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe('computeWeightedTotal', () => {
  it('returns 0.0 when all dimensions are 0', () => {
    expect(
      computeWeightedTotal({
        roleFit: 0,
        industryAlignment: 0,
        painPointOverlap: 0,
        buyingSignalStrength: 0,
      }),
    ).toBe(0.0);
  });
  it('returns 1.0 when all dimensions are 1.0', () => {
    expect(
      computeWeightedTotal({
        roleFit: 1,
        industryAlignment: 1,
        painPointOverlap: 1,
        buyingSignalStrength: 1,
      }),
    ).toBe(1.0);
  });
  it('computes correct weighted sum', () => {
    const b: CorrelationBreakdown = {
      roleFit: 0.8,
      industryAlignment: 0.6,
      painPointOverlap: 0.9,
      buyingSignalStrength: 0.4,
    };
    expect(computeWeightedTotal(b)).toBeCloseTo(
      0.25 * 0.8 + 0.25 * 0.6 + 0.35 * 0.9 + 0.15 * 0.4,
      3,
    );
  });
});

describe('computeCorrelationScore', () => {
  beforeEach(() => setOpenAIClient(null));
  afterEach(() => setOpenAIClient(null));

  it('produces a score between 0.0 and 1.0', async () => {
    const result = await computeCorrelationScore(
      makeLead(),
      makeResearchProfile(),
      makeEnrichedICP(),
    );
    expect(result.total).toBeGreaterThanOrEqual(0.0);
    expect(result.total).toBeLessThanOrEqual(1.0);
    for (const v of Object.values(result.breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0.0);
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });

  it('produces deterministic results', async () => {
    const args = [makeLead(), makeResearchProfile(), makeEnrichedICP()] as const;
    const r1 = await computeCorrelationScore(...args);
    const r2 = await computeCorrelationScore(...args);
    expect(r1.total).toBe(r2.total);
    expect(r1.breakdown).toEqual(r2.breakdown);
  });

  it('returns 0.0 when all inputs mismatch', async () => {
    const result = await computeCorrelationScore(
      makeLead({ role: 'Designer', industry: 'Healthcare' }),
      makeResearchProfile({ currentChallenges: [], recentActivity: [] }),
      makeEnrichedICP({ targetRole: 'CTO', industry: 'SaaS', painPointsSolved: [] }),
    );
    expect(result.total).toBe(0.0);
  });

  it('total equals weighted sum of breakdown', async () => {
    const result = await computeCorrelationScore(
      makeLead(),
      makeResearchProfile(),
      makeEnrichedICP(),
    );
    const expected =
      CORRELATION_WEIGHTS.roleFit * result.breakdown.roleFit +
      CORRELATION_WEIGHTS.industryAlignment * result.breakdown.industryAlignment +
      CORRELATION_WEIGHTS.painPointOverlap * result.breakdown.painPointOverlap +
      CORRELATION_WEIGHTS.buyingSignalStrength * result.breakdown.buyingSignalStrength;
    expect(result.total).toBeCloseTo(expected, 3);
  });
});
