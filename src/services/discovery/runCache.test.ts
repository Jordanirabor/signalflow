import { beforeEach, describe, expect, it } from 'vitest';
import { createRunCache } from './runCache';
import type { CachedCompanyData, RunCache } from './types';

describe('PipelineRunCache', () => {
  let cache: RunCache;

  beforeEach(() => {
    cache = createRunCache();
  });

  describe('companyData', () => {
    const data: CachedCompanyData = {
      websiteContent: 'About us page',
      teamMembers: [{ name: 'Alice', role: 'CTO' }],
      techStack: ['TypeScript', 'React'],
      emailPatterns: ['{first}.{last}@example.com'],
    };

    it('returns null for unknown domain', () => {
      expect(cache.getCompanyData('unknown.com')).toBeNull();
    });

    it('stores and retrieves company data', () => {
      cache.setCompanyData('example.com', data);
      expect(cache.getCompanyData('example.com')).toEqual(data);
    });

    it('normalizes domain keys (case-insensitive)', () => {
      cache.setCompanyData('Example.COM', data);
      expect(cache.getCompanyData('example.com')).toEqual(data);
    });

    it('normalizes trailing dots and slashes', () => {
      cache.setCompanyData('example.com./', data);
      expect(cache.getCompanyData('example.com')).toEqual(data);
    });
  });

  describe('mxRecords', () => {
    const records = ['mx1.example.com', 'mx2.example.com'];

    it('returns null for unknown domain', () => {
      expect(cache.getMXRecords('unknown.com')).toBeNull();
    });

    it('stores and retrieves MX records', () => {
      cache.setMXRecords('example.com', records);
      expect(cache.getMXRecords('example.com')).toEqual(records);
    });

    it('normalizes domain keys', () => {
      cache.setMXRecords('EXAMPLE.COM', records);
      expect(cache.getMXRecords('example.com')).toEqual(records);
    });
  });

  describe('emailPattern', () => {
    it('returns null for unknown domain', () => {
      expect(cache.getEmailPattern('unknown.com')).toBeNull();
    });

    it('stores and retrieves email pattern', () => {
      cache.setEmailPattern('example.com', '{first}.{last}');
      expect(cache.getEmailPattern('example.com')).toBe('{first}.{last}');
    });

    it('normalizes domain keys', () => {
      cache.setEmailPattern('Example.Com', '{first}.{last}');
      expect(cache.getEmailPattern('example.com')).toBe('{first}.{last}');
    });
  });

  describe('clear', () => {
    it('removes all cached data', () => {
      cache.setCompanyData('a.com', {
        websiteContent: '',
        teamMembers: [],
        techStack: [],
        emailPatterns: [],
      });
      cache.setMXRecords('b.com', ['mx.b.com']);
      cache.setEmailPattern('c.com', '{first}');

      cache.clear();

      expect(cache.getCompanyData('a.com')).toBeNull();
      expect(cache.getMXRecords('b.com')).toBeNull();
      expect(cache.getEmailPattern('c.com')).toBeNull();
    });
  });
});
