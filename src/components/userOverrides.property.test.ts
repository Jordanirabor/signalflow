import {
  buildSubmissionPayload,
  mapPersonToForm,
  type NewLeadForm,
} from '@/components/autofillMapping';
import type { PersonSearchResult } from '@/services/peopleSearchService';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Property 6: User overrides take precedence over autofill
 *
 * For any PersonSearchResult that has been selected and any set of
 * user-modified field values, when the form is submitted, the payload
 * sent to POST /api/leads SHALL contain the user-modified values,
 * not the original autofill values.
 *
 * **Validates: Requirements 5.3, 6.1**
 */

const FORM_FIELDS = ['name', 'role', 'company', 'industry', 'geography', 'email'] as const;
type FormField = (typeof FORM_FIELDS)[number];

/** Arbitrary that generates a PersonSearchResult with non-empty trimmed strings. */
const personSearchResultArb: fc.Arbitrary<PersonSearchResult> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 80 }).map((s) => s.trim() || 'Default'),
  role: fc.string({ minLength: 1, maxLength: 80 }).map((s) => s.trim() || 'Engineer'),
  company: fc.string({ minLength: 1, maxLength: 80 }).map((s) => s.trim() || 'Acme'),
  industry: fc.string({ maxLength: 80 }),
  geography: fc.string({ maxLength: 80 }),
  email: fc.string({ maxLength: 80 }),
});

/**
 * Arbitrary that generates a partial set of user overrides.
 * Each override is a non-empty trimmed string so we can distinguish it
 * from the original autofill value in the payload.
 */
const userOverridesArb: fc.Arbitrary<Partial<Record<FormField, string>>> = fc
  .subarray([...FORM_FIELDS], { minLength: 1 })
  .chain((fields) => {
    const entries = fields.map((field) =>
      fc.string({ minLength: 1, maxLength: 80 }).map((val) => [field, val] as const),
    );
    return fc
      .tuple(...(entries as [(typeof entries)[0], ...typeof entries]))
      .map((pairs) => Object.fromEntries(pairs) as Partial<Record<FormField, string>>);
  });

describe('Property 6: User overrides take precedence over autofill', () => {
  it('submitted payload contains user-modified values, not original autofill values', () => {
    fc.assert(
      fc.property(personSearchResultArb, userOverridesArb, (person, overrides) => {
        // Step 1: Autofill the form from the selected person
        const autofilled: NewLeadForm = mapPersonToForm(person);

        // Step 2: Apply user overrides (simulates user editing fields)
        const finalForm: NewLeadForm = { ...autofilled, ...overrides };

        // Step 3: Build the submission payload
        const payload = buildSubmissionPayload(finalForm);

        // Step 4: Verify each overridden field in the payload matches the user value
        for (const [field, userValue] of Object.entries(overrides) as [FormField, string][]) {
          const trimmed = userValue.trim();
          if (field === 'name') {
            // name is the only truly required field — always present as trimmed
            expect(payload[field]).toBe(trimmed);
          } else {
            // All other fields (role, company, industry, geography, email) are
            // optional in LeadSubmissionPayload — omitted when empty after trim
            if (trimmed === '') {
              expect(payload[field]).toBeUndefined();
            } else {
              expect(payload[field]).toBe(trimmed);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('non-overridden fields retain their autofilled values in the payload', () => {
    fc.assert(
      fc.property(personSearchResultArb, userOverridesArb, (person, overrides) => {
        const autofilled: NewLeadForm = mapPersonToForm(person);
        const finalForm: NewLeadForm = { ...autofilled, ...overrides };
        const payload = buildSubmissionPayload(finalForm);

        // Fields NOT in overrides should still reflect the autofilled value
        for (const field of FORM_FIELDS) {
          if (field in overrides) continue;

          const originalTrimmed = person[field].trim();
          if (field === 'name') {
            // name is always present as trimmed
            expect(payload[field]).toBe(originalTrimmed);
          } else {
            // All other fields are optional — omitted when empty after trim
            if (originalTrimmed === '') {
              expect(payload[field]).toBeUndefined();
            } else {
              expect(payload[field]).toBe(originalTrimmed);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
