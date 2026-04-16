import { describe, expect, it } from 'vitest';
import { scoreConfidence } from './confidenceScorer';
import type { FieldCorroboration } from './types';

describe('scoreConfidence', () => {
  it('returns 0.0 for empty corroborations array', () => {
    expect(scoreConfidence([])).toBe(0.0);
  });

  it('returns 0.0 for a field with zero sources', () => {
    const corroborations: FieldCorroboration[] = [{ field: 'name', sources: [], value: 'Alice' }];
    expect(scoreConfidence(corroborations)).toBe(0.0);
  });

  describe('single source scoring', () => {
    it('scores <= 0.5 for a single standard scrape source', () => {
      const corroborations: FieldCorroboration[] = [
        { field: 'name', sources: ['linkedin_scrape'], value: 'Alice' },
      ];
      const score = scoreConfidence(corroborations);
      expect(score).toBeLessThanOrEqual(0.5);
      expect(score).toBeGreaterThan(0.0);
    });

    it('scores <= 0.5 for a single premium API source', () => {
      const corroborations: FieldCorroboration[] = [
        { field: 'name', sources: ['apollo_api'], value: 'Alice' },
      ];
      const score = scoreConfidence(corroborations);
      expect(score).toBeLessThanOrEqual(0.5);
      expect(score).toBeGreaterThan(0.0);
    });
  });

  describe('two source scoring', () => {
    it('scores ~0.7 for two standard scrape sources', () => {
      const corroborations: FieldCorroboration[] = [
        { field: 'name', sources: ['linkedin_scrape', 'github_scrape'], value: 'Alice' },
      ];
      const score = scoreConfidence(corroborations);
      expect(score).toBeGreaterThanOrEqual(0.65);
      expect(score).toBeLessThanOrEqual(0.8);
    });

    it('scores higher with a premium source among two', () => {
      const standard: FieldCorroboration[] = [
        { field: 'name', sources: ['linkedin_scrape', 'github_scrape'], value: 'Alice' },
      ];
      const withPremium: FieldCorroboration[] = [
        { field: 'name', sources: ['linkedin_scrape', 'apollo_api'], value: 'Alice' },
      ];
      expect(scoreConfidence(withPremium)).toBeGreaterThan(scoreConfidence(standard));
    });
  });

  describe('three or more source scoring', () => {
    it('scores >= 0.9 for three standard sources', () => {
      const corroborations: FieldCorroboration[] = [
        {
          field: 'name',
          sources: ['linkedin_scrape', 'github_scrape', 'twitter_scrape'],
          value: 'Alice',
        },
      ];
      expect(scoreConfidence(corroborations)).toBeGreaterThanOrEqual(0.9);
    });

    it('scores >= 0.9 for four sources including premium', () => {
      const corroborations: FieldCorroboration[] = [
        {
          field: 'name',
          sources: ['linkedin_scrape', 'github_scrape', 'twitter_scrape', 'clearbit_api'],
          value: 'Alice',
        },
      ];
      const score = scoreConfidence(corroborations);
      expect(score).toBeGreaterThanOrEqual(0.9);
      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('multiple fields averaging', () => {
    it('averages scores across multiple fields', () => {
      const corroborations: FieldCorroboration[] = [
        {
          field: 'name',
          sources: ['linkedin_scrape', 'github_scrape', 'twitter_scrape'],
          value: 'Alice',
        },
        { field: 'email', sources: ['smtp_verify'], value: 'alice@example.com' },
      ];
      const score = scoreConfidence(corroborations);
      // 3 sources → 0.9, 1 source → 0.4, average ~0.65
      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThan(0.9);
    });

    it('premium fields get higher weight in the average', () => {
      const allStandard: FieldCorroboration[] = [
        { field: 'name', sources: ['linkedin_scrape'], value: 'Alice' },
        { field: 'email', sources: ['smtp_verify'], value: 'alice@example.com' },
      ];
      const onePremium: FieldCorroboration[] = [
        { field: 'name', sources: ['apollo_api'], value: 'Alice' },
        { field: 'email', sources: ['smtp_verify'], value: 'alice@example.com' },
      ];
      // Premium field gets higher weight, pulling the average up
      expect(scoreConfidence(onePremium)).toBeGreaterThan(scoreConfidence(allStandard));
    });
  });

  describe('score bounds', () => {
    it('always returns a score in [0.0, 1.0]', () => {
      const testCases: FieldCorroboration[][] = [
        [],
        [{ field: 'a', sources: [], value: '' }],
        [{ field: 'a', sources: ['s1'], value: 'v' }],
        [{ field: 'a', sources: ['s1', 's2'], value: 'v' }],
        [{ field: 'a', sources: ['s1', 's2', 's3'], value: 'v' }],
        [{ field: 'a', sources: ['s1', 's2', 's3', 'api_premium', 's5'], value: 'v' }],
        [
          { field: 'a', sources: ['api1', 'api2', 'api3'], value: 'v' },
          { field: 'b', sources: ['api4', 'api5', 'api6'], value: 'v' },
        ],
      ];

      for (const corroborations of testCases) {
        const score = scoreConfidence(corroborations);
        expect(score).toBeGreaterThanOrEqual(0.0);
        expect(score).toBeLessThanOrEqual(1.0);
      }
    });
  });
});
