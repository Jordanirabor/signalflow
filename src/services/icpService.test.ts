import type OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ICP } from '@/types';
import {
  generateEnrichedICP,
  getEnrichedICP,
  saveEnrichedICP,
  setOpenAIClient,
  validatePainPoints,
} from './icpService';

// ---------------------------------------------------------------------------
// Mock the database module
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

import { query } from '@/lib/db';
const mockQuery = vi.mocked(query);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockOpenAI(responseContent: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseContent } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

function makeBaseICP(overrides?: Partial<ICP>): ICP {
  return {
    id: 'icp-1',
    founderId: 'founder-1',
    targetRole: 'VP of Engineering',
    industry: 'SaaS',
    companyStage: 'Series A',
    geography: 'US',
    customTags: ['devtools'],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

const VALID_AI_RESPONSE = JSON.stringify({
  valueProposition: 'Reduce deployment time by 80%',
  painPointsSolved: ['Slow CI/CD pipelines', 'Manual deployment processes'],
  competitorContext: 'Competes with Jenkins and CircleCI',
  idealCustomerCharacteristics: 'Engineering teams with 10+ developers',
});

// ---------------------------------------------------------------------------
// validatePainPoints
// ---------------------------------------------------------------------------

describe('validatePainPoints', () => {
  it('accepts 1–10 valid items', () => {
    const result = validatePainPoints(['Pain point 1', 'Pain point 2']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects empty array', () => {
    const result = validatePainPoints([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('at least 1');
  });

  it('rejects more than 10 items', () => {
    const items = Array.from({ length: 11 }, (_, i) => `Pain ${i}`);
    const result = validatePainPoints(items);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('at most 10');
  });

  it('rejects items exceeding 200 characters', () => {
    const result = validatePainPoints(['x'.repeat(201)]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('exceeds 200');
  });

  it('rejects empty string items', () => {
    const result = validatePainPoints(['']);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('non-empty');
  });
});

// ---------------------------------------------------------------------------
// generateEnrichedICP
// ---------------------------------------------------------------------------

describe('generateEnrichedICP', () => {
  afterEach(() => {
    setOpenAIClient(null);
  });

  it('generates enrichment fields from product description', async () => {
    setOpenAIClient(makeMockOpenAI(VALID_AI_RESPONSE));
    const baseICP = makeBaseICP();

    const result = await generateEnrichedICP('A CI/CD platform for fast deployments', baseICP);

    expect(result.productDescription).toBe('A CI/CD platform for fast deployments');
    expect(result.valueProposition).toBe('Reduce deployment time by 80%');
    expect(result.painPointsSolved).toEqual([
      'Slow CI/CD pipelines',
      'Manual deployment processes',
    ]);
    expect(result.competitorContext).toBe('Competes with Jenkins and CircleCI');
    expect(result.idealCustomerCharacteristics).toBe('Engineering teams with 10+ developers');
    expect(result.enrichmentGeneratedAt).toBeInstanceOf(Date);
  });

  it('preserves base ICP fields from existingICP', async () => {
    setOpenAIClient(makeMockOpenAI(VALID_AI_RESPONSE));
    const baseICP = makeBaseICP();

    const result = await generateEnrichedICP('Some product', baseICP);

    expect(result.targetRole).toBe('VP of Engineering');
    expect(result.industry).toBe('SaaS');
    expect(result.companyStage).toBe('Series A');
    expect(result.geography).toBe('US');
    expect(result.customTags).toEqual(['devtools']);
    expect(result.id).toBe('icp-1');
    expect(result.founderId).toBe('founder-1');
  });

  it('throws when productDescription is empty', async () => {
    await expect(generateEnrichedICP('', makeBaseICP())).rejects.toThrow(
      'productDescription is required',
    );
  });

  it('throws with ICP_ENRICHMENT_FAILED code on OpenAI failure', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('API rate limit')),
        },
      },
    } as unknown as OpenAI;
    setOpenAIClient(mockClient);

    try {
      await generateEnrichedICP('Some product', makeBaseICP());
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('Enriched ICP generation failed');
      expect((err as Error & { code: string }).code).toBe('ICP_ENRICHMENT_FAILED');
    }
  });

  it('clamps pain points exceeding 200 chars', async () => {
    const response = JSON.stringify({
      valueProposition: 'Value',
      painPointsSolved: ['x'.repeat(250)],
      competitorContext: 'Context',
      idealCustomerCharacteristics: 'Chars',
    });
    setOpenAIClient(makeMockOpenAI(response));

    const result = await generateEnrichedICP('Product', makeBaseICP());
    expect(result.painPointsSolved![0].length).toBeLessThanOrEqual(200);
  });

  it('provides default pain point when AI returns empty list', async () => {
    const response = JSON.stringify({
      valueProposition: 'Value',
      painPointsSolved: [],
      competitorContext: 'Context',
      idealCustomerCharacteristics: 'Chars',
    });
    setOpenAIClient(makeMockOpenAI(response));

    const result = await generateEnrichedICP('Product', makeBaseICP());
    expect(result.painPointsSolved!.length).toBeGreaterThanOrEqual(1);
  });

  it('caps pain points at 10 items', async () => {
    const response = JSON.stringify({
      valueProposition: 'Value',
      painPointsSolved: Array.from({ length: 15 }, (_, i) => `Pain ${i}`),
      competitorContext: 'Context',
      idealCustomerCharacteristics: 'Chars',
    });
    setOpenAIClient(makeMockOpenAI(response));

    const result = await generateEnrichedICP('Product', makeBaseICP());
    expect(result.painPointsSolved!.length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// getEnrichedICP
// ---------------------------------------------------------------------------

describe('getEnrichedICP', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns null when no ICP exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
    const result = await getEnrichedICP('founder-1');
    expect(result).toBeNull();
  });

  it('returns enriched ICP with all fields mapped', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'icp-1',
          founder_id: 'founder-1',
          target_role: 'CTO',
          industry: 'Fintech',
          company_stage: 'Series B',
          geography: 'EU',
          custom_tags: ['payments'],
          product_description: 'Payment platform',
          value_proposition: 'Faster payments',
          pain_points_solved: ['Slow settlements'],
          competitor_context: 'Stripe, Adyen',
          ideal_customer_characteristics: 'Mid-market companies',
          enrichment_generated_at: new Date('2025-06-01'),
          created_at: new Date('2025-01-01'),
          updated_at: new Date('2025-06-01'),
        },
      ],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await getEnrichedICP('founder-1');
    expect(result).not.toBeNull();
    expect(result!.productDescription).toBe('Payment platform');
    expect(result!.valueProposition).toBe('Faster payments');
    expect(result!.painPointsSolved).toEqual(['Slow settlements']);
    expect(result!.competitorContext).toBe('Stripe, Adyen');
    expect(result!.idealCustomerCharacteristics).toBe('Mid-market companies');
    expect(result!.targetRole).toBe('CTO');
    expect(result!.industry).toBe('Fintech');
  });

  it('maps null enrichment fields to undefined', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'icp-1',
          founder_id: 'founder-1',
          target_role: 'CTO',
          industry: 'Fintech',
          company_stage: null,
          geography: null,
          custom_tags: null,
          product_description: null,
          value_proposition: null,
          pain_points_solved: null,
          competitor_context: null,
          ideal_customer_characteristics: null,
          enrichment_generated_at: null,
          created_at: new Date('2025-01-01'),
          updated_at: new Date('2025-01-01'),
        },
      ],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await getEnrichedICP('founder-1');
    expect(result!.productDescription).toBeUndefined();
    expect(result!.valueProposition).toBeUndefined();
    expect(result!.painPointsSolved).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// saveEnrichedICP
// ---------------------------------------------------------------------------

describe('saveEnrichedICP', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('throws when no base ICP exists for founder', async () => {
    // getEnrichedICP returns null
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

    await expect(
      saveEnrichedICP({
        founderId: 'founder-1',
        productDescription: 'Product',
      }),
    ).rejects.toThrow('No ICP found');
  });

  it('updates enrichment fields and returns enriched ICP', async () => {
    const existingRow = {
      id: 'icp-1',
      founder_id: 'founder-1',
      target_role: 'CTO',
      industry: 'Fintech',
      company_stage: null,
      geography: null,
      custom_tags: null,
      product_description: null,
      value_proposition: null,
      pain_points_solved: null,
      competitor_context: null,
      ideal_customer_characteristics: null,
      enrichment_generated_at: null,
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
    };

    // First call: getEnrichedICP (SELECT)
    mockQuery.mockResolvedValueOnce({
      rows: [existingRow],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const updatedRow = {
      ...existingRow,
      product_description: 'New product',
      value_proposition: 'New value',
      pain_points_solved: ['Pain 1'],
      competitor_context: 'Competitors',
      ideal_customer_characteristics: 'Ideal chars',
      enrichment_generated_at: new Date(),
      updated_at: new Date(),
    };

    // Second call: UPDATE
    mockQuery.mockResolvedValueOnce({
      rows: [updatedRow],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    const result = await saveEnrichedICP({
      founderId: 'founder-1',
      productDescription: 'New product',
      valueProposition: 'New value',
      painPointsSolved: ['Pain 1'],
      competitorContext: 'Competitors',
      idealCustomerCharacteristics: 'Ideal chars',
    });

    expect(result.productDescription).toBe('New product');
    expect(result.valueProposition).toBe('New value');
    expect(result.painPointsSolved).toEqual(['Pain 1']);
    // Base fields preserved
    expect(result.targetRole).toBe('CTO');
    expect(result.industry).toBe('Fintech');
  });

  it('rejects invalid pain points', async () => {
    const existingRow = {
      id: 'icp-1',
      founder_id: 'founder-1',
      target_role: 'CTO',
      industry: 'Fintech',
      company_stage: null,
      geography: null,
      custom_tags: null,
      product_description: null,
      value_proposition: null,
      pain_points_solved: null,
      competitor_context: null,
      ideal_customer_characteristics: null,
      enrichment_generated_at: null,
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
    };

    mockQuery.mockResolvedValueOnce({
      rows: [existingRow],
      rowCount: 1,
      command: '',
      oid: 0,
      fields: [],
    });

    await expect(
      saveEnrichedICP({
        founderId: 'founder-1',
        painPointsSolved: [], // empty — invalid
      }),
    ).rejects.toThrow('Invalid painPointsSolved');
  });
});
