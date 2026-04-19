/**
 * Pure utility functions for IMAP inbox monitoring operations.
 *
 * All functions are pure (no side effects) and exported for testability.
 */

/**
 * Validates that a poll interval is an integer in the range [1, 60].
 * Non-integers and values outside the range are rejected with an error message.
 */
export function validatePollInterval(interval: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(interval) || interval < 1 || interval > 60) {
    return {
      valid: false,
      error: 'Poll interval must be an integer between 1 and 60 minutes',
    };
  }
  return { valid: true };
}

/**
 * Returns the maximum UID from a list of UIDs.
 * Returns 0 for an empty list.
 */
export function computeLastSeenUid(uids: number[]): number {
  if (uids.length === 0) {
    return 0;
  }
  return Math.max(...uids);
}

/**
 * Returns true if the given UID is strictly greater than lastSeenUid,
 * indicating it should be fetched (not yet processed).
 */
export function shouldFetchUid(uid: number, lastSeenUid: number): boolean {
  return uid > lastSeenUid;
}

/**
 * Recursively searches a MIME part tree for a text/plain part and returns its body.
 * Returns an empty string if no text/plain part is found.
 */
export function extractPlainTextFromMime(
  parts: Array<{ mimeType: string; body: string; parts?: any[] }>,
): string {
  for (const part of parts) {
    if (part.mimeType === 'text/plain') {
      return part.body;
    }
    if (part.parts && part.parts.length > 0) {
      const nested = extractPlainTextFromMime(part.parts);
      if (nested !== '') {
        return nested;
      }
    }
  }
  return '';
}

/**
 * Returns true if the number of consecutive failures is >= 3,
 * indicating the IMAP connection should be deactivated.
 */
export function shouldDeactivateConnection(consecutiveFailures: number): boolean {
  return consecutiveFailures >= 3;
}
