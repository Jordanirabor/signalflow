import {
  formatGenericError,
  formatSuccessToast,
  formatThrottleError,
  isSendDisabled,
  shouldTransitionToContacted,
} from '@/lib/composeEmailUtils';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Feature: outreach-email-ux
 * Property 1: Send button disabled state is correct for all input combinations
 *
 * **Validates: Requirements 1.3, 2.3, 3.6**
 */
describe('Property 1: Send button disabled state is correct for all input combinations', () => {
  it('isSendDisabled returns true iff any prerequisite fails', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.string(),
        fc.boolean(),
        (gmailConnected, hasEmail, body, isSending) => {
          const result = isSendDisabled(gmailConnected, hasEmail, body, isSending);

          const anyPrerequisiteFails = !gmailConnected || !hasEmail || !body.trim() || isSending;

          expect(result).toBe(anyPrerequisiteFails);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: outreach-email-ux
 * Property 2: CRM status transition is applied if and only if current status is "New"
 *
 * **Validates: Requirements 5.2**
 */
describe('Property 2: CRM status transition is applied if and only if current status is "New"', () => {
  const crmStatuses = ['New', 'Contacted', 'Replied', 'Booked', 'Closed'] as const;

  it('shouldTransitionToContacted returns true only for "New"', () => {
    fc.assert(
      fc.property(fc.constantFrom(...crmStatuses), (status) => {
        const result = shouldTransitionToContacted(status);
        expect(result).toBe(status === 'New');
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: outreach-email-ux
 * Property 3: Success toast message contains recipient and subject
 *
 * **Validates: Requirements 6.2, 6.3**
 */
describe('Property 3: Success toast message contains recipient and subject', () => {
  it('formatSuccessToast output contains both the email and the subject', () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (email, subject) => {
          const result = formatSuccessToast(email, subject);
          expect(result).toContain(email);
          expect(result).toContain(subject);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: outreach-email-ux
 * Property 4: Throttle error message includes limit value
 *
 * **Validates: Requirements 7.3**
 */
describe('Property 4: Throttle error message includes limit value', () => {
  it('formatThrottleError output contains String(limit)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1 }), fc.integer({ min: 1 }), (limit, used) => {
        const result = formatThrottleError(limit, used);
        expect(result).toContain(String(limit));
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: outreach-email-ux
 * Property 5: Generic API error message is displayed verbatim
 *
 * **Validates: Requirements 7.4**
 */
describe('Property 5: Generic API error message is displayed verbatim', () => {
  it('formatGenericError output contains the original error string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (message) => {
          const result = formatGenericError(message);
          expect(result).toContain(message);
        },
      ),
      { numRuns: 100 },
    );
  });
});
