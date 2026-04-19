import { maskPassword } from '@/lib/credentialUtils';
import { describe, expect, it } from 'vitest';

describe('maskPassword', () => {
  it('masks a long password showing last 4 chars', () => {
    expect(maskPassword('mypassword123')).toBe('*********d123');
  });

  it('returns just the last 4 chars for a 4-char password', () => {
    expect(maskPassword('abcd')).toBe('abcd');
  });

  it('returns all stars for a 3-char password', () => {
    expect(maskPassword('abc')).toBe('***');
  });

  it('returns all stars for a 2-char password', () => {
    expect(maskPassword('ab')).toBe('**');
  });

  it('returns a single star for a 1-char password', () => {
    expect(maskPassword('x')).toBe('*');
  });

  it('returns empty string for empty input', () => {
    expect(maskPassword('')).toBe('');
  });

  it('masks a 5-char password with 1 star prefix', () => {
    expect(maskPassword('hello')).toBe('*ello');
  });
});
