import { describe, expect, it } from 'vitest';

import { isObfuscatedName, resolveObfuscatedName } from './waterfallEmailFinder';

describe('isObfuscatedName', () => {
  it('returns true for names containing asterisks', () => {
    expect(isObfuscatedName('John Sm***h')).toBe(true);
    expect(isObfuscatedName('J*** D**')).toBe(true);
    expect(isObfuscatedName('*')).toBe(true);
  });

  it('returns false for normal names', () => {
    expect(isObfuscatedName('John Smith')).toBe(false);
    expect(isObfuscatedName('Jane Doe')).toBe(false);
    expect(isObfuscatedName('')).toBe(false);
  });
});

describe('resolveObfuscatedName', () => {
  const linkedInProspects = [
    { name: 'John Smith', company: 'Acme Corp' },
    { name: 'Jane Doe', company: 'Acme Corp' },
    { name: 'Bob Johnson', company: 'Other Inc' },
  ];

  it('resolves obfuscated last name by matching LinkedIn prospects', () => {
    const result = resolveObfuscatedName('John Sm***h', 'Acme Corp', linkedInProspects);
    expect(result).toBe('John Smith');
  });

  it('returns original name when no match found', () => {
    const result = resolveObfuscatedName('Alice W***s', 'Acme Corp', linkedInProspects);
    expect(result).toBe('Alice W***s');
  });

  it('returns original name when company does not match', () => {
    const result = resolveObfuscatedName('John Sm***h', 'Different Corp', linkedInProspects);
    expect(result).toBe('John Sm***h');
  });

  it('returns non-obfuscated names unchanged', () => {
    const result = resolveObfuscatedName('John Smith', 'Acme Corp', linkedInProspects);
    expect(result).toBe('John Smith');
  });

  it('returns single-word obfuscated names unchanged', () => {
    const result = resolveObfuscatedName('J***', 'Acme Corp', linkedInProspects);
    expect(result).toBe('J***');
  });

  it('handles case-insensitive company matching', () => {
    const result = resolveObfuscatedName('John Sm***h', 'acme corp', linkedInProspects);
    expect(result).toBe('John Smith');
  });

  it('handles case-insensitive name matching', () => {
    const prospects = [{ name: 'john smith', company: 'Acme Corp' }];
    const result = resolveObfuscatedName('John Sm***h', 'Acme Corp', prospects);
    expect(result).toBe('john smith');
  });

  it('returns original when linkedInProspects is empty', () => {
    const result = resolveObfuscatedName('John Sm***h', 'Acme Corp', []);
    expect(result).toBe('John Sm***h');
  });

  it('matches names regardless of asterisk count', () => {
    // "Sm***h" → /^sm.+h$/i → matches "smith"
    const result = resolveObfuscatedName('John Sm***h', 'Acme Corp', linkedInProspects);
    expect(result).toBe('John Smith');

    // "Sm*h" → /^sm.+h$/i → also matches "smith" (asterisk count doesn't matter)
    const result2 = resolveObfuscatedName('John Sm*h', 'Acme Corp', linkedInProspects);
    expect(result2).toBe('John Smith');
  });
});
