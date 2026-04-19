import { mapPersonToForm } from '@/components/autofillMapping';
import type { PersonSearchResult } from '@/services/peopleSearchService';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Property 5: Autofill populates all fields from selected person
 *
 * For any PersonSearchResult, when the user selects that person from the
 * dropdown, the form's name input and all Autofill_Fields (role, company,
 * industry, geography, email) SHALL each equal the corresponding field
 * from the selected PersonSearchResult.
 *
 * **Validates: Requirements 4.1, 4.2, 4.4**
 */

// Arbitrary that generates a PersonSearchResult with arbitrary string values,
// including edge cases like empty strings, special characters, and unicode.
const personSearchResultArb: fc.Arbitrary<PersonSearchResult> = fc.record({
  name: fc.string({ maxLength: 100 }),
  role: fc.string({ maxLength: 100 }),
  company: fc.string({ maxLength: 100 }),
  industry: fc.string({ maxLength: 100 }),
  geography: fc.string({ maxLength: 100 }),
  email: fc.string({ maxLength: 100 }),
});

describe('Property 5: Autofill populates all fields from selected person', () => {
  it('mapPersonToForm produces a form where every field equals the corresponding PersonSearchResult field', () => {
    fc.assert(
      fc.property(personSearchResultArb, (person) => {
        const form = mapPersonToForm(person);

        expect(form.name).toBe(person.name);
        expect(form.role).toBe(person.role);
        expect(form.company).toBe(person.company);
        expect(form.industry).toBe(person.industry);
        expect(form.geography).toBe(person.geography);
        expect(form.email).toBe(person.email);
      }),
      { numRuns: 100 },
    );
  });

  it('mapPersonToForm returns exactly the six expected fields and no extras', () => {
    fc.assert(
      fc.property(personSearchResultArb, (person) => {
        const form = mapPersonToForm(person);
        const keys = Object.keys(form).sort();

        expect(keys).toEqual(['company', 'email', 'geography', 'industry', 'name', 'role']);
      }),
      { numRuns: 100 },
    );
  });
});
