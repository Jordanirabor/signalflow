import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock playwright before importing
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addInitScript: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue({
          setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          goto: vi.fn().mockResolvedValue({ status: () => 200 }),
          evaluate: vi.fn().mockResolvedValue(''),
          context: vi.fn().mockReturnValue({
            close: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('./antiDetection', () => ({
  getNextUserAgent: vi.fn().mockReturnValue('Mozilla/5.0 TestAgent'),
  getNextProxy: vi.fn().mockReturnValue(null),
  getRandomDelay: vi.fn().mockReturnValue(2),
  applyAntiDetection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./rateLimiter', () => ({
  acquirePermit: vi.fn().mockResolvedValue(undefined),
  recordRequest: vi.fn(),
}));

import type { CompanyWebsiteData } from './companyWebsiteScraper';
import {
  detectTechStack,
  extractDomain,
  extractEmails,
  formatCompanyInfo,
} from './companyWebsiteScraper';

describe('companyWebsiteScraper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractEmails', () => {
    it('extracts email addresses from text', () => {
      const text = 'Contact us at hello@example.com or sales@company.io for more info.';
      const emails = extractEmails(text);
      expect(emails).toEqual(['hello@example.com', 'sales@company.io']);
    });

    it('returns empty array when no emails found', () => {
      expect(extractEmails('No emails here')).toEqual([]);
    });

    it('deduplicates and lowercases emails', () => {
      const text = 'Email: John@Example.COM and also john@example.com';
      const emails = extractEmails(text);
      expect(emails).toEqual(['john@example.com']);
    });

    it('handles multiple emails on same domain', () => {
      const text = 'team: alice@co.com, bob@co.com, carol@co.com';
      const emails = extractEmails(text);
      expect(emails).toHaveLength(3);
      expect(emails).toContain('alice@co.com');
      expect(emails).toContain('bob@co.com');
      expect(emails).toContain('carol@co.com');
    });
  });

  describe('detectTechStack', () => {
    it('detects tech keywords in text', () => {
      const text = 'We use React and Node.js with PostgreSQL on AWS.';
      const stack = detectTechStack(text);
      expect(stack).toContain('react');
      expect(stack).toContain('node.js');
      expect(stack).toContain('postgresql');
      expect(stack).toContain('aws');
    });

    it('returns empty array when no tech keywords found', () => {
      expect(detectTechStack('We sell organic coffee beans.')).toEqual([]);
    });

    it('deduplicates results', () => {
      const text = 'React React React and more React';
      const stack = detectTechStack(text);
      expect(stack.filter((k) => k === 'react')).toHaveLength(1);
    });

    it('uses word boundary matching for short keywords', () => {
      // "go" should match as a standalone word, not inside "google"
      const text = 'We write services in Go and deploy with Docker.';
      const stack = detectTechStack(text);
      expect(stack).toContain('go');
      expect(stack).toContain('docker');
    });
  });

  describe('formatCompanyInfo', () => {
    it('formats full company data into structured string', () => {
      const data: CompanyWebsiteData = {
        description: 'A leading SaaS platform for developers.',
        teamMembers: [
          { name: 'Alice Smith', role: 'CEO' },
          { name: 'Bob Jones', role: 'CTO' },
        ],
        techStack: ['react', 'node.js', 'postgresql'],
        emailPatterns: ['hello@example.com'],
      };
      const info = formatCompanyInfo(data);
      expect(info).toContain('Description: A leading SaaS platform');
      expect(info).toContain('Team Members:');
      expect(info).toContain('Alice Smith (CEO)');
      expect(info).toContain('Bob Jones (CTO)');
      expect(info).toContain('Tech Stack: react, node.js, postgresql');
    });

    it('returns empty string when no data available', () => {
      const data: CompanyWebsiteData = {
        description: '',
        teamMembers: [],
        techStack: [],
        emailPatterns: [],
      };
      expect(formatCompanyInfo(data)).toBe('');
    });

    it('caps team members at 10', () => {
      const members = Array.from({ length: 15 }, (_, i) => ({
        name: `Person ${i + 1} Name`,
        role: `Role ${i + 1}`,
      }));
      const data: CompanyWebsiteData = {
        description: '',
        teamMembers: members,
        techStack: [],
        emailPatterns: [],
      };
      const info = formatCompanyInfo(data);
      expect(info).toContain('Person 10 Name');
      expect(info).not.toContain('Person 11 Name');
    });

    it('omits role parentheses when role is empty', () => {
      const data: CompanyWebsiteData = {
        description: '',
        teamMembers: [{ name: 'Alice Smith', role: '' }],
        techStack: [],
        emailPatterns: [],
      };
      const info = formatCompanyInfo(data);
      expect(info).toContain('Alice Smith');
      expect(info).not.toContain('()');
    });
  });

  describe('extractDomain', () => {
    it('extracts domain from full URL', () => {
      expect(extractDomain('https://www.example.com/about')).toBe('www.example.com');
    });

    it('extracts domain from URL without protocol', () => {
      expect(extractDomain('example.com')).toBe('example.com');
    });

    it('returns empty string for invalid URL', () => {
      expect(extractDomain('')).toBe('');
    });

    it('handles subdomains', () => {
      expect(extractDomain('https://blog.company.io/posts')).toBe('blog.company.io');
    });
  });

  describe('companyWebsiteScraper adapter', () => {
    it('has correct name and capabilities', async () => {
      const { companyWebsiteScraper } = await import('./companyWebsiteScraper');
      expect(companyWebsiteScraper.name).toBe('company_website_scrape');
      expect(companyWebsiteScraper.capabilities).toEqual(['enrichment']);
    });

    it('isEnabled always returns true', async () => {
      const { companyWebsiteScraper } = await import('./companyWebsiteScraper');
      expect(companyWebsiteScraper.isEnabled()).toBe(true);
    });

    it('returns empty when no companyDomain on prospect', async () => {
      const { companyWebsiteScraper } = await import('./companyWebsiteScraper');
      const result = await companyWebsiteScraper.enrich!({
        name: 'John Doe',
        company: 'Acme Inc',
      });
      expect(result).toEqual({});
    });
  });
});
