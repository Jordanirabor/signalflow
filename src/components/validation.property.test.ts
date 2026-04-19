import { validateLeadForm, type NewLeadForm } from '@/components/autofillMapping';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Property 7: Empty or whitespace-only name blocks submission
 *
 * For any string composed entirely of whitespace (including the empty string),
 * attempting to submit the Lead_Form SHALL be prevented by validation,
 * regardless of whether a person was selected from the dropdown.
 *
 * **Validates: Requirements 6.2**
 */

/** Arbitrary that generates whitespace-only strings (including empty). */
const whitespaceOnlyArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'))
  .map((chars) => chars.join(''));

/** Arbitrary that generates a full NewLeadForm with a whitespace-only name. */
const formWithWhitespaceNameArb: fc.Arbitrary<NewLeadForm> = fc.record({
  name: whitespaceOnlyArb,
  role: fc.string({ maxLength: 80 }),
  company: fc.string({ maxLength: 80 }),
  industry: fc.string({ maxLength: 80 }),
  geography: fc.string({ maxLength: 80 }),
  email: fc.string({ maxLength: 80 }),
});

describe('Property 7: Empty or whitespace-only name blocks submission', () => {
  it('validation fails with a name error when name is whitespace-only, regardless of selectedPerson', () => {
    fc.assert(
      fc.property(formWithWhitespaceNameArb, fc.boolean(), (form, hasSelectedPerson) => {
        const errors = validateLeadForm(form, hasSelectedPerson);

        // Validation must produce at least one error
        expect(Object.keys(errors).length).toBeGreaterThan(0);

        // The name field specifically must have an error
        expect(errors.name).toBeDefined();
        expect(errors.name).toBe('Name is required');
      }),
      { numRuns: 100 },
    );
  });
});
