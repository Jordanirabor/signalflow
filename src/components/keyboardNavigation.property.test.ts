import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Property 4: Keyboard navigation stays in bounds
 *
 * For any non-empty array of search results and any sequence of ArrowUp
 * and ArrowDown key presses, the highlighted index SHALL always remain
 * within the range [0, results.length - 1].
 *
 * This mirrors the navigation logic in LeadListView.tsx handleNameKeyDown:
 *   ArrowDown → Math.min(prev + 1, results.length - 1)
 *   ArrowUp   → Math.max(prev - 1, 0)
 *
 * **Validates: Requirements 3.3**
 */

type KeyPress = 'ArrowDown' | 'ArrowUp';

/**
 * Pure simulation of the keyboard navigation state machine
 * extracted from LeadListView's handleNameKeyDown handler.
 */
function applyKeyPress(index: number, key: KeyPress, resultsLength: number): number {
  if (key === 'ArrowDown') {
    return Math.min(index + 1, resultsLength - 1);
  }
  return Math.max(index - 1, 0);
}

// Arbitrary for a single key press
const keyPressArb: fc.Arbitrary<KeyPress> = fc.constantFrom('ArrowDown', 'ArrowUp');

describe('Property 4: Keyboard navigation stays in bounds', () => {
  it('highlightedIndex stays within [0, results.length - 1] for any sequence of ArrowUp/ArrowDown presses', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }), // results array length (non-empty)
        fc.array(keyPressArb, { minLength: 1, maxLength: 50 }), // sequence of key presses
        (resultsLength, keyPresses) => {
          let index = 0; // highlightedIndex starts at 0

          for (const key of keyPresses) {
            index = applyKeyPress(index, key, resultsLength);

            // After every key press, index must be in bounds
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThanOrEqual(resultsLength - 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
