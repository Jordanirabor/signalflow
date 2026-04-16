import { describe, expect, it } from 'vitest';

import {
  deduplicateBusinesses,
  type MapsBusinessListing,
  normalizeAddress,
  normalizeBusinessName,
} from './mapsScraper';

// ---------------------------------------------------------------------------
// normalizeBusinessName
// ---------------------------------------------------------------------------

describe('normalizeBusinessName', () => {
  it('lowercases and trims the name', () => {
    expect(normalizeBusinessName('  Acme Corp  ')).toBe('acme corp');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeBusinessName('Acme   Corp   Inc')).toBe('acme corp inc');
  });

  it('handles already-normalized names', () => {
    expect(normalizeBusinessName('acme')).toBe('acme');
  });
});

// ---------------------------------------------------------------------------
// normalizeAddress
// ---------------------------------------------------------------------------

describe('normalizeAddress', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeAddress('  123  Main  St  ')).toBe('123 main st');
  });

  it('removes trailing punctuation', () => {
    expect(normalizeAddress('123 Main St.,')).toBe('123 main st');
  });

  it('handles already-normalized addresses', () => {
    expect(normalizeAddress('456 oak ave')).toBe('456 oak ave');
  });
});

// ---------------------------------------------------------------------------
// deduplicateBusinesses
// ---------------------------------------------------------------------------

describe('deduplicateBusinesses', () => {
  const makeListing = (
    name: string,
    address: string,
    websiteUrl: string | null = null,
  ): MapsBusinessListing => ({
    name,
    address,
    websiteUrl,
    phone: null,
    category: null,
  });

  it('removes duplicates with same normalized name + address', () => {
    const listings = [
      makeListing('Acme Corp', '123 Main St'),
      makeListing('  acme corp  ', '123  Main  St'),
      makeListing('Acme Corp', '456 Oak Ave'),
    ];

    const result = deduplicateBusinesses(listings);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Acme Corp');
    expect(result[0].address).toBe('123 Main St');
    expect(result[1].address).toBe('456 Oak Ave');
  });

  it('keeps first occurrence when duplicates exist', () => {
    const listings = [
      makeListing('Acme Corp', '123 Main St', 'https://acme.com'),
      makeListing('acme corp', '123 main st', 'https://other.com'),
    ];

    const result = deduplicateBusinesses(listings);
    expect(result).toHaveLength(1);
    expect(result[0].websiteUrl).toBe('https://acme.com');
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateBusinesses([])).toEqual([]);
  });

  it('returns all items when no duplicates', () => {
    const listings = [
      makeListing('Acme Corp', '123 Main St'),
      makeListing('Beta Inc', '456 Oak Ave'),
      makeListing('Gamma LLC', '789 Pine Rd'),
    ];

    const result = deduplicateBusinesses(listings);
    expect(result).toHaveLength(3);
  });

  it('treats same name at different addresses as distinct', () => {
    const listings = [
      makeListing('Starbucks', '100 First Ave'),
      makeListing('Starbucks', '200 Second Ave'),
    ];

    const result = deduplicateBusinesses(listings);
    expect(result).toHaveLength(2);
  });
});
