import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRelevantResult, newsScraper } from './newsScraper';

// ---------------------------------------------------------------------------
// isRelevantResult helper
// ---------------------------------------------------------------------------

describe('isRelevantResult', () => {
  it('returns true when snippet contains the prospect name (case-insensitive)', () => {
    expect(isRelevantResult('John Smith announced a new product', 'John Smith', 'Acme Corp')).toBe(
      true,
    );
  });

  it('returns true when snippet contains the company name (case-insensitive)', () => {
    expect(isRelevantResult('Acme Corp raises Series B funding', 'Jane Doe', 'Acme Corp')).toBe(
      true,
    );
  });

  it('returns true when snippet contains both name and company', () => {
    expect(
      isRelevantResult(
        'John Smith, CEO of Acme Corp, spoke at the event',
        'John Smith',
        'Acme Corp',
      ),
    ).toBe(true);
  });

  it('returns false when snippet contains neither name nor company', () => {
    expect(
      isRelevantResult('Unrelated article about weather patterns', 'John Smith', 'Acme Corp'),
    ).toBe(false);
  });

  it('returns false for empty snippet', () => {
    expect(isRelevantResult('', 'John Smith', 'Acme Corp')).toBe(false);
  });

  it('is case-insensitive for prospect name', () => {
    expect(isRelevantResult('JOHN SMITH was featured in Forbes', 'john smith', 'Acme')).toBe(true);
  });

  it('is case-insensitive for company name', () => {
    expect(isRelevantResult('acme corp launches new tool', 'Jane', 'ACME CORP')).toBe(true);
  });

  it('handles empty prospect name gracefully', () => {
    expect(isRelevantResult('Acme Corp news', '', 'Acme Corp')).toBe(true);
  });

  it('handles empty company name gracefully', () => {
    expect(isRelevantResult('John Smith news', 'John Smith', '')).toBe(true);
  });

  it('returns false when both name and company are empty', () => {
    expect(isRelevantResult('Some article text', '', '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// newsScraper adapter structure
// ---------------------------------------------------------------------------

describe('newsScraper adapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SERPER_API_KEY = 'test-serper-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('has name "news_scrape"', () => {
    expect(newsScraper.name).toBe('news_scrape');
  });

  it('has enrichment capability only', () => {
    expect(newsScraper.capabilities).toEqual(['enrichment']);
  });

  it('isEnabled returns true when SERPER_API_KEY is set', () => {
    expect(newsScraper.isEnabled()).toBe(true);
  });

  it('isEnabled returns false when SERPER_API_KEY is not set', () => {
    delete process.env.SERPER_API_KEY;
    expect(newsScraper.isEnabled()).toBe(false);
  });

  it('has an enrich method', () => {
    expect(typeof newsScraper.enrich).toBe('function');
  });

  it('does not have a discover method', () => {
    expect(newsScraper.discover).toBeUndefined();
  });
});
