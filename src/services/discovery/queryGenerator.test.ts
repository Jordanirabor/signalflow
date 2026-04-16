import { vi } from 'vitest';
import { generateFallbackQueries, generateQueries, setOpenAIClient } from './queryGenerator';
import type { AnnotatedQuery, ICP } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_VECTORS: AnnotatedQuery['vector'][] = [
  'linkedin',
  'directory',
  'github',
  'twitter',
  'maps',
  'general',
];

function makeICP(overrides?: Partial<ICP>): ICP {
  return {
    id: 'icp-1',
    founderId: 'founder-1',
    targetRole: 'CTO',
    industry: 'SaaS',
    companyStage: 'Series A',
    geography: 'San Francisco',
    customTags: ['AI', 'B2B'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockOpenAI(response: Array<{ query: string; vector: string }>) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(response),
              },
            },
          ],
        }),
      },
    },
  } as unknown as import('openai').default;
}

function makeMockOpenAIFailure() {
  return {
    chat: {
      completions: {
        create: vi.fn().mockRejectedValue(new Error('API key invalid')),
      },
    },
  } as unknown as import('openai').default;
}

// ---------------------------------------------------------------------------
// generateFallbackQueries
// ---------------------------------------------------------------------------

describe('generateFallbackQueries', () => {
  it('returns at least 5 queries for a full ICP', () => {
    const icp = makeICP();
    const queries = generateFallbackQueries(icp);
    expect(queries.length).toBeGreaterThanOrEqual(5);
  });

  it('returns at least 5 queries for a minimal ICP (no optional fields)', () => {
    const icp = makeICP({
      geography: undefined,
      companyStage: undefined,
      customTags: undefined,
    });
    const queries = generateFallbackQueries(icp);
    expect(queries.length).toBeGreaterThanOrEqual(5);
  });

  it('covers at least 3 distinct vectors', () => {
    const icp = makeICP();
    const queries = generateFallbackQueries(icp);
    const vectors = new Set(queries.map((q) => q.vector));
    expect(vectors.size).toBeGreaterThanOrEqual(3);
  });

  it('all queries have valid vectors', () => {
    const icp = makeICP();
    const queries = generateFallbackQueries(icp);
    for (const q of queries) {
      expect(VALID_VECTORS).toContain(q.vector);
    }
  });

  it('all queries are non-empty and <= 256 characters', () => {
    const icp = makeICP();
    const queries = generateFallbackQueries(icp);
    for (const q of queries) {
      expect(q.query.length).toBeGreaterThan(0);
      expect(q.query.length).toBeLessThanOrEqual(256);
    }
  });

  it('all queries are unique', () => {
    const icp = makeICP();
    const queries = generateFallbackQueries(icp);
    const queryStrings = queries.map((q) => q.query);
    expect(new Set(queryStrings).size).toBe(queryStrings.length);
  });

  it('all queries are URL-safe (encodeURIComponent round-trips)', () => {
    const icp = makeICP();
    const queries = generateFallbackQueries(icp);
    for (const q of queries) {
      // Should not throw
      const encoded = encodeURIComponent(q.query);
      expect(encoded.length).toBeGreaterThan(0);
    }
  });

  it('includes linkedin vector queries', () => {
    const icp = makeICP();
    const queries = generateFallbackQueries(icp);
    expect(queries.some((q) => q.vector === 'linkedin')).toBe(true);
  });

  it('includes general vector queries', () => {
    const icp = makeICP();
    const queries = generateFallbackQueries(icp);
    expect(queries.some((q) => q.vector === 'general')).toBe(true);
  });

  it('includes maps vector when geography is provided', () => {
    const icp = makeICP({ geography: 'New York' });
    const queries = generateFallbackQueries(icp);
    expect(queries.some((q) => q.vector === 'maps')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateQueries (AI path)
// ---------------------------------------------------------------------------

describe('generateQueries', () => {
  afterEach(() => {
    setOpenAIClient(null);
  });

  it('returns AI-generated queries when OpenAI succeeds', async () => {
    const mockResponse = [
      { query: 'site:linkedin.com/in/ CTO SaaS San Francisco', vector: 'linkedin' },
      { query: 'site:crunchbase.com SaaS Series A CTO', vector: 'directory' },
      { query: 'site:github.com CTO SaaS open source', vector: 'github' },
      { query: 'site:twitter.com CTO SaaS thought leader', vector: 'twitter' },
      { query: 'SaaS companies San Francisco CTO hiring', vector: 'general' },
    ];
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const icp = makeICP();
    const result = await generateQueries(icp);

    expect(result.generationMethod).toBe('ai');
    expect(result.queries.length).toBeGreaterThanOrEqual(5);
  });

  it('falls back to template queries when OpenAI fails', async () => {
    setOpenAIClient(makeMockOpenAIFailure());

    const icp = makeICP();
    const result = await generateQueries(icp);

    expect(result.generationMethod).toBe('template_fallback');
    expect(result.queries.length).toBeGreaterThanOrEqual(5);
  });

  it('falls back when OpenAI returns empty content', async () => {
    const mock = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: '' } }],
          }),
        },
      },
    } as unknown as import('openai').default;
    setOpenAIClient(mock);

    const icp = makeICP();
    const result = await generateQueries(icp);

    expect(result.generationMethod).toBe('template_fallback');
    expect(result.queries.length).toBeGreaterThanOrEqual(5);
  });

  it('falls back when OpenAI returns invalid JSON', async () => {
    const mock = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'not json at all' } }],
          }),
        },
      },
    } as unknown as import('openai').default;
    setOpenAIClient(mock);

    const icp = makeICP();
    const result = await generateQueries(icp);

    expect(result.generationMethod).toBe('template_fallback');
  });

  it('filters out queries with invalid vectors from AI response', async () => {
    const mockResponse = [
      { query: 'site:linkedin.com/in/ CTO SaaS', vector: 'linkedin' },
      { query: 'some query', vector: 'invalid_vector' },
      { query: 'site:crunchbase.com SaaS CTO', vector: 'directory' },
      { query: 'site:github.com CTO SaaS', vector: 'github' },
      { query: 'site:twitter.com CTO SaaS', vector: 'twitter' },
      { query: 'CTO SaaS companies', vector: 'general' },
    ];
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const icp = makeICP();
    const result = await generateQueries(icp);

    // The invalid_vector query should be filtered out
    for (const q of result.queries) {
      expect(VALID_VECTORS).toContain(q.vector);
    }
  });

  it('deduplicates identical queries from AI response', async () => {
    const mockResponse = [
      { query: 'site:linkedin.com/in/ CTO SaaS', vector: 'linkedin' },
      { query: 'site:linkedin.com/in/ CTO SaaS', vector: 'linkedin' },
      { query: 'site:crunchbase.com SaaS CTO', vector: 'directory' },
      { query: 'site:github.com CTO SaaS', vector: 'github' },
      { query: 'site:twitter.com CTO SaaS', vector: 'twitter' },
      { query: 'CTO SaaS companies', vector: 'general' },
    ];
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const icp = makeICP();
    const result = await generateQueries(icp);

    const queryStrings = result.queries.map((q) => q.query);
    expect(new Set(queryStrings).size).toBe(queryStrings.length);
  });

  it('truncates queries exceeding maxQueryLength', async () => {
    const longQuery = 'a'.repeat(300);
    const mockResponse = [
      { query: longQuery, vector: 'linkedin' },
      { query: 'site:crunchbase.com SaaS CTO', vector: 'directory' },
      { query: 'site:github.com CTO SaaS', vector: 'github' },
      { query: 'site:twitter.com CTO SaaS', vector: 'twitter' },
      { query: 'CTO SaaS companies', vector: 'general' },
    ];
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const icp = makeICP();
    const result = await generateQueries(icp);

    for (const q of result.queries) {
      expect(q.query.length).toBeLessThanOrEqual(256);
    }
  });

  it('supplements with fallback queries when AI returns fewer than minQueries', async () => {
    const mockResponse = [
      { query: 'site:linkedin.com/in/ CTO SaaS', vector: 'linkedin' },
      { query: 'site:crunchbase.com SaaS CTO', vector: 'directory' },
    ];
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const icp = makeICP();
    const result = await generateQueries(icp);

    expect(result.queries.length).toBeGreaterThanOrEqual(5);
  });

  it('respects custom config for minQueries', async () => {
    const mockResponse = Array.from({ length: 10 }, (_, i) => ({
      query: `query ${i} site:linkedin.com/in/ CTO SaaS variant ${i}`,
      vector: (['linkedin', 'directory', 'github', 'twitter', 'maps', 'general'] as const)[i % 6],
    }));
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const icp = makeICP();
    const result = await generateQueries(icp, { minQueries: 8 });

    expect(result.queries.length).toBeGreaterThanOrEqual(8);
  });
});
