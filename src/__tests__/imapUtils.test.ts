import {
  computeLastSeenUid,
  extractPlainTextFromMime,
  shouldDeactivateConnection,
  shouldFetchUid,
  validatePollInterval,
} from '@/lib/imapUtils';
import { describe, expect, it } from 'vitest';

describe('validatePollInterval', () => {
  it('accepts 1 as valid', () => {
    expect(validatePollInterval(1)).toEqual({ valid: true });
  });

  it('accepts 60 as valid', () => {
    expect(validatePollInterval(60)).toEqual({ valid: true });
  });

  it('accepts 30 as valid', () => {
    expect(validatePollInterval(30)).toEqual({ valid: true });
  });

  it('rejects 0', () => {
    const result = validatePollInterval(0);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects 61', () => {
    const result = validatePollInterval(61);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects negative numbers', () => {
    const result = validatePollInterval(-5);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('1 and 60');
  });

  it('rejects non-integer floats', () => {
    const result = validatePollInterval(5.5);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('computeLastSeenUid', () => {
  it('returns 0 for an empty list', () => {
    expect(computeLastSeenUid([])).toBe(0);
  });

  it('returns the single UID for a one-element list', () => {
    expect(computeLastSeenUid([42])).toBe(42);
  });

  it('returns the max UID from multiple UIDs', () => {
    expect(computeLastSeenUid([3, 7, 2, 9, 1])).toBe(9);
  });
});

describe('shouldFetchUid', () => {
  it('returns true when uid > lastSeenUid', () => {
    expect(shouldFetchUid(10, 5)).toBe(true);
  });

  it('returns false when uid === lastSeenUid', () => {
    expect(shouldFetchUid(5, 5)).toBe(false);
  });

  it('returns false when uid < lastSeenUid', () => {
    expect(shouldFetchUid(3, 5)).toBe(false);
  });
});

describe('extractPlainTextFromMime', () => {
  it('returns body of a top-level text/plain part', () => {
    const parts = [{ mimeType: 'text/plain', body: 'Hello world' }];
    expect(extractPlainTextFromMime(parts)).toBe('Hello world');
  });

  it('returns empty string when no text/plain part exists', () => {
    const parts = [{ mimeType: 'text/html', body: '<p>Hello</p>' }];
    expect(extractPlainTextFromMime(parts)).toBe('');
  });

  it('finds text/plain in nested multipart structure', () => {
    const parts = [
      {
        mimeType: 'multipart/alternative',
        body: '',
        parts: [
          { mimeType: 'text/plain', body: 'Nested plain text' },
          { mimeType: 'text/html', body: '<p>Nested HTML</p>' },
        ],
      },
    ];
    expect(extractPlainTextFromMime(parts)).toBe('Nested plain text');
  });

  it('returns empty string for an empty parts array', () => {
    expect(extractPlainTextFromMime([])).toBe('');
  });

  it('returns the first text/plain found (depth-first)', () => {
    const parts = [
      { mimeType: 'text/html', body: '<p>HTML</p>' },
      { mimeType: 'text/plain', body: 'First plain' },
      { mimeType: 'text/plain', body: 'Second plain' },
    ];
    expect(extractPlainTextFromMime(parts)).toBe('First plain');
  });
});

describe('shouldDeactivateConnection', () => {
  it('returns false for 0 failures', () => {
    expect(shouldDeactivateConnection(0)).toBe(false);
  });

  it('returns false for 2 failures', () => {
    expect(shouldDeactivateConnection(2)).toBe(false);
  });

  it('returns true for exactly 3 failures', () => {
    expect(shouldDeactivateConnection(3)).toBe(true);
  });

  it('returns true for more than 3 failures', () => {
    expect(shouldDeactivateConnection(5)).toBe(true);
  });
});
