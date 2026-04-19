import { searchPeopleByName } from '@/services/peopleSearchService';
import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Property 1: Search result cap
 *
 * For any valid name query (≥ 2 characters), `searchPeopleByName` returns
 * at most 10 items, regardless of how many results Apollo returns.
 *
 * **Validates: Requirements 2.1**
 */

// Arbitrary that generates a valid Apollo person object
const apolloPersonArb = fc.record({
  first_name: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  last_name: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  title: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  email: fc.option(fc.emailAddress(), { nil: undefined }),
  organization: fc.option(
    fc.record({
      name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
      industry: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    }),
    { nil: undefined },
  ),
  city: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  state: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  country: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
});

// Arbitrary for a valid name query (≥ 2 characters)
const validNameQueryArb = fc
  .string({ minLength: 2, maxLength: 100 })
  .filter((s) => s.trim().length >= 2);

describe('Property 1: Search result cap', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv('APOLLO_ENABLED', 'true');
    vi.stubEnv('APOLLO_API_KEY', 'test-api-key');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('searchPeopleByName returns at most 10 items for any Apollo response length', async () => {
    await fc.assert(
      fc.asyncProperty(
        validNameQueryArb,
        fc.array(apolloPersonArb, { minLength: 0, maxLength: 50 }),
        async (nameQuery, people) => {
          // Mock fetch to return the generated people array
          globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ people }),
          }) as unknown as typeof fetch;

          const results = await searchPeopleByName(nameQuery);

          expect(results.length).toBeLessThanOrEqual(10);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 2: Apollo response mapping field completeness
 *
 * For any Apollo person object with arbitrary combinations of present/missing
 * fields, the mapping produces a `PersonSearchResult` with all six fields
 * (name, role, company, industry, geography, email) as strings (empty string
 * for missing).
 *
 * **Validates: Requirements 2.2, 4.4**
 */

import { mapApolloPerson } from '@/services/peopleSearchService';

describe('Property 2: Apollo response mapping field completeness', () => {
  it('mapApolloPerson produces all six string fields for any Apollo person object', () => {
    fc.assert(
      fc.property(apolloPersonArb, (person) => {
        const result = mapApolloPerson(person);

        // All six fields must be present and be strings
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('role');
        expect(result).toHaveProperty('company');
        expect(result).toHaveProperty('industry');
        expect(result).toHaveProperty('geography');
        expect(result).toHaveProperty('email');

        expect(typeof result.name).toBe('string');
        expect(typeof result.role).toBe('string');
        expect(typeof result.company).toBe('string');
        expect(typeof result.industry).toBe('string');
        expect(typeof result.geography).toBe('string');
        expect(typeof result.email).toBe('string');
      }),
      { numRuns: 100 },
    );
  });
});
