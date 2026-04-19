import { renderDropdownItems } from '@/components/searchDropdownRenderer';
import type { PersonSearchResult } from '@/services/peopleSearchService';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Property 3: Dropdown renders all results with required fields
 *
 * For any non-empty array of PersonSearchResult items, the rendered
 * Search_Dropdown SHALL contain each result's name, role, company,
 * and email in the output.
 *
 * **Validates: Requirements 3.1**
 */

// Arbitrary that generates a PersonSearchResult with non-empty strings
// for the four fields that must appear in the dropdown (name, role, company, email).
// Industry and geography are not displayed in the dropdown but are part of the type.
const personSearchResultArb: fc.Arbitrary<PersonSearchResult> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  role: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  company: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  industry: fc.string({ maxLength: 50 }),
  geography: fc.string({ maxLength: 50 }),
  email: fc.emailAddress(),
});

describe('Property 3: Dropdown renders all results with required fields', () => {
  it('every PersonSearchResult has its name, role, company, and email present in the rendered dropdown output', () => {
    fc.assert(
      fc.property(fc.array(personSearchResultArb, { minLength: 1, maxLength: 20 }), (results) => {
        const views = renderDropdownItems(results);

        // One view per result
        expect(views).toHaveLength(results.length);

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const view = views[i];

          // Name appears in the primary text
          expect(view.primaryText).toContain(result.name);

          // Role appears in the secondary text
          expect(view.secondaryText).toContain(result.role);

          // Company appears in the secondary text (prefixed with " at ")
          expect(view.secondaryText).toContain(result.company);

          // Email appears in the secondary text (prefixed with " · ")
          expect(view.secondaryText).toContain(result.email);
        }
      }),
      { numRuns: 100 },
    );
  });
});
