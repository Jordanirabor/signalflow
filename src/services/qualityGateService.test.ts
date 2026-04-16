import type { EnrichmentData, OutreachRecord } from '@/types';
import { describe, expect, it } from 'vitest';
import {
  hasPersonalization,
  hasValidEmail,
  meetsScoreThreshold,
  noDuplicateWithin24h,
  runAllChecks,
  withinWordLimit,
} from './qualityGateService';

// --- Helpers ---

function makeOutreachRecord(overrides: Partial<OutreachRecord> = {}): OutreachRecord {
  return {
    id: 'or-1',
    leadId: 'lead-1',
    founderId: 'founder-1',
    channel: 'email',
    messageContent: 'Hello',
    outreachDate: new Date(),
    isFollowUp: false,
    createdAt: new Date(),
    ...overrides,
  };
}

// --- hasPersonalization ---

describe('hasPersonalization', () => {
  it('passes when message contains linkedinBio', () => {
    const enrichment: EnrichmentData = { linkedinBio: 'AI researcher at Stanford' };
    expect(hasPersonalization('I saw you are an AI researcher at Stanford', enrichment)).toBe(true);
  });

  it('passes when message contains companyInfo', () => {
    const enrichment: EnrichmentData = { companyInfo: 'Series A startup' };
    expect(hasPersonalization('Your Series A startup caught my eye', enrichment)).toBe(true);
  });

  it('passes when message contains a recent post', () => {
    const enrichment: EnrichmentData = { recentPosts: ['post about scaling teams'] };
    expect(hasPersonalization('Loved your post about scaling teams', enrichment)).toBe(true);
  });

  it('fails when message contains no enrichment elements', () => {
    const enrichment: EnrichmentData = { linkedinBio: 'AI researcher', companyInfo: 'Acme Corp' };
    expect(hasPersonalization('Generic hello message', enrichment)).toBe(false);
  });

  it('fails when enrichmentData is undefined', () => {
    expect(hasPersonalization('Hello there', undefined)).toBe(false);
  });

  it('fails when message is empty', () => {
    const enrichment: EnrichmentData = { linkedinBio: 'Bio' };
    expect(hasPersonalization('', enrichment)).toBe(false);
  });

  it('fails when enrichment fields are empty strings', () => {
    const enrichment: EnrichmentData = { linkedinBio: '', companyInfo: '  ', recentPosts: [''] };
    expect(hasPersonalization('Some message', enrichment)).toBe(false);
  });
});

// --- withinWordLimit ---

describe('withinWordLimit', () => {
  it('passes for DM with exactly 150 words', () => {
    const msg = Array(150).fill('word').join(' ');
    expect(withinWordLimit(msg, 'dm')).toBe(true);
  });

  it('rejects DM with 151 words', () => {
    const msg = Array(151).fill('word').join(' ');
    expect(withinWordLimit(msg, 'dm')).toBe(false);
  });

  it('passes for email with exactly 250 words', () => {
    const msg = Array(250).fill('word').join(' ');
    expect(withinWordLimit(msg, 'email')).toBe(true);
  });

  it('rejects email with 251 words', () => {
    const msg = Array(251).fill('word').join(' ');
    expect(withinWordLimit(msg, 'email')).toBe(false);
  });

  it('passes for empty message', () => {
    expect(withinWordLimit('', 'dm')).toBe(true);
  });
});

// --- meetsScoreThreshold ---

describe('meetsScoreThreshold', () => {
  it('passes when score equals threshold', () => {
    expect(meetsScoreThreshold(50, 50)).toBe(true);
  });

  it('passes when score exceeds threshold', () => {
    expect(meetsScoreThreshold(80, 50)).toBe(true);
  });

  it('fails when score is below threshold', () => {
    expect(meetsScoreThreshold(30, 50)).toBe(false);
  });
});

// --- noDuplicateWithin24h ---

describe('noDuplicateWithin24h', () => {
  it('passes when no outreach records exist', () => {
    expect(noDuplicateWithin24h('lead-1', 'email', [])).toBe(true);
  });

  it('passes when records are older than 24h', () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const records = [
      makeOutreachRecord({ leadId: 'lead-1', channel: 'email', outreachDate: oldDate }),
    ];
    expect(noDuplicateWithin24h('lead-1', 'email', records)).toBe(true);
  });

  it('rejects when same-channel record exists within 24h', () => {
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const records = [
      makeOutreachRecord({ leadId: 'lead-1', channel: 'email', outreachDate: recentDate }),
    ];
    expect(noDuplicateWithin24h('lead-1', 'email', records)).toBe(false);
  });

  it('passes when record is for different channel', () => {
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const records = [
      makeOutreachRecord({ leadId: 'lead-1', channel: 'dm', outreachDate: recentDate }),
    ];
    expect(noDuplicateWithin24h('lead-1', 'email', records)).toBe(true);
  });

  it('passes when record is for different lead', () => {
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const records = [
      makeOutreachRecord({ leadId: 'lead-2', channel: 'email', outreachDate: recentDate }),
    ];
    expect(noDuplicateWithin24h('lead-1', 'email', records)).toBe(true);
  });
});

// --- hasValidEmail ---

describe('hasValidEmail', () => {
  it('passes for valid email', () => {
    expect(hasValidEmail('user@example.com')).toBe(true);
  });

  it('fails for empty string', () => {
    expect(hasValidEmail('')).toBe(false);
  });

  it('fails for no @ sign', () => {
    expect(hasValidEmail('userexample.com')).toBe(false);
  });

  it('fails for multiple @ signs', () => {
    expect(hasValidEmail('user@@example.com')).toBe(false);
  });

  it('fails for empty local part', () => {
    expect(hasValidEmail('@example.com')).toBe(false);
  });

  it('fails for empty domain', () => {
    expect(hasValidEmail('user@')).toBe(false);
  });

  it('fails for domain without dot', () => {
    expect(hasValidEmail('user@localhost')).toBe(false);
  });

  it('fails for domain starting with dot', () => {
    expect(hasValidEmail('user@.example.com')).toBe(false);
  });

  it('fails for domain ending with dot', () => {
    expect(hasValidEmail('user@example.')).toBe(false);
  });
});

// --- runAllChecks ---

describe('runAllChecks', () => {
  const baseParams = {
    message: 'I noticed your work as an AI researcher at Stanford and wanted to reach out.',
    enrichmentData: { linkedinBio: 'AI researcher at Stanford' } as EnrichmentData,
    channel: 'email' as const,
    leadScore: 75,
    minScore: 50,
    leadId: 'lead-1',
    outreachRecords: [] as OutreachRecord[],
    email: 'user@example.com',
  };

  it('passes when all checks pass', () => {
    const result = runAllChecks(baseParams);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('collects all failures when multiple checks fail', () => {
    const result = runAllChecks({
      ...baseParams,
      message: 'Generic message with no personalization',
      enrichmentData: { linkedinBio: 'Something else entirely' },
      leadScore: 20,
      email: 'invalid',
    });
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
    const checkNames = result.failures.map((f) => f.check);
    expect(checkNames).toContain('personalization');
    expect(checkNames).toContain('scoreThreshold');
    expect(checkNames).toContain('validEmail');
  });

  it('includes wordLimit failure when message is too long', () => {
    const longMessage = Array(260).fill('word').join(' ');
    const result = runAllChecks({
      ...baseParams,
      message: longMessage,
    });
    expect(result.passed).toBe(false);
    const checkNames = result.failures.map((f) => f.check);
    expect(checkNames).toContain('wordLimit');
  });

  it('includes duplicateWithin24h failure when recent record exists', () => {
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const result = runAllChecks({
      ...baseParams,
      outreachRecords: [
        makeOutreachRecord({ leadId: 'lead-1', channel: 'email', outreachDate: recentDate }),
      ],
    });
    expect(result.passed).toBe(false);
    const checkNames = result.failures.map((f) => f.check);
    expect(checkNames).toContain('duplicateWithin24h');
  });
});
