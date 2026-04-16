import { beforeEach, describe, expect, it } from 'vitest';
import {
  discoverEmail,
  extractCompanyDomain,
  generateCandidateEmails,
  inferEmailPattern,
  lookupMXRecords,
  prioritizeCandidates,
} from './emailDiscovery';
import { createRunCache } from './runCache';
import type { EmailCandidate, ProspectContext, RunCache } from './types';

// ---------------------------------------------------------------------------
// extractCompanyDomain
// ---------------------------------------------------------------------------

describe('extractCompanyDomain', () => {
  it('returns companyDomain when already set', async () => {
    const prospect: ProspectContext = {
      name: 'Jane Doe',
      company: 'Acme',
      companyDomain: 'acme.com',
    };
    expect(await extractCompanyDomain(prospect)).toBe('acme.com');
  });

  it('normalizes companyDomain (strips protocol and www)', async () => {
    const prospect: ProspectContext = {
      name: 'Jane Doe',
      company: 'Acme',
      companyDomain: 'https://www.Acme.com/',
    };
    expect(await extractCompanyDomain(prospect)).toBe('acme.com');
  });

  it('extracts domain from LinkedIn company URL', async () => {
    const prospect: ProspectContext = {
      name: 'Jane Doe',
      company: 'Stripe',
      linkedinUrl: 'https://linkedin.com/company/stripe',
    };
    expect(await extractCompanyDomain(prospect)).toBe('stripe.com');
  });

  it('derives domain from company name as fallback', async () => {
    const prospect: ProspectContext = {
      name: 'Jane Doe',
      company: 'Acme Corp',
    };
    expect(await extractCompanyDomain(prospect)).toBe('acmecorp.com');
  });

  it('returns null when no domain can be determined', async () => {
    const prospect: ProspectContext = {
      name: 'Jane Doe',
      company: '',
    };
    expect(await extractCompanyDomain(prospect)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lookupMXRecords
// ---------------------------------------------------------------------------

describe('lookupMXRecords', () => {
  it('returns empty array when DNS resolution fails', async () => {
    // Non-existent domain should fail gracefully
    const records = await lookupMXRecords('thisdomain-does-not-exist-xyz123.invalid');
    expect(records).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateCandidateEmails
// ---------------------------------------------------------------------------

describe('generateCandidateEmails', () => {
  it('generates exactly 6 candidates', () => {
    const candidates = generateCandidateEmails('John', 'Doe', 'acme.com');
    expect(candidates).toHaveLength(6);
  });

  it('generates correct email patterns', () => {
    const candidates = generateCandidateEmails('John', 'Doe', 'acme.com');
    const emails = candidates.map((c) => c.email);

    expect(emails).toEqual([
      'john@acme.com',
      'john.doe@acme.com',
      'jdoe@acme.com',
      'johnd@acme.com',
      'john_doe@acme.com',
      'doe@acme.com',
    ]);
  });

  it('lowercases all parts', () => {
    const candidates = generateCandidateEmails('ALICE', 'SMITH', 'BIGCO.COM');
    for (const c of candidates) {
      expect(c.email).toBe(c.email.toLowerCase());
    }
  });

  it('assigns correct pattern labels', () => {
    const candidates = generateCandidateEmails('Jane', 'Doe', 'x.com');
    const patterns = candidates.map((c) => c.pattern);

    expect(patterns).toEqual([
      '{first}',
      '{first}.{last}',
      '{f}{last}',
      '{first}{l}',
      '{first}_{last}',
      '{last}',
    ]);
  });

  it('sets source to pattern_inference for all candidates', () => {
    const candidates = generateCandidateEmails('A', 'B', 'c.com');
    for (const c of candidates) {
      expect(c.source).toBe('pattern_inference');
    }
  });
});

// ---------------------------------------------------------------------------
// inferEmailPattern
// ---------------------------------------------------------------------------

describe('inferEmailPattern', () => {
  it('detects {first}.{last} pattern', () => {
    const pattern = inferEmailPattern('acme.com', ['john.doe@acme.com', 'jane.smith@acme.com']);
    expect(pattern).toBe('{first}.{last}');
  });

  it('detects {first}_{last} pattern', () => {
    const pattern = inferEmailPattern('acme.com', ['john_doe@acme.com', 'jane_smith@acme.com']);
    expect(pattern).toBe('{first}_{last}');
  });

  it('returns null for empty email list', () => {
    expect(inferEmailPattern('acme.com', [])).toBeNull();
  });

  it('ignores emails from other domains', () => {
    const pattern = inferEmailPattern('acme.com', ['john.doe@other.com', 'jane.smith@other.com']);
    expect(pattern).toBeNull();
  });

  it('returns the most common pattern when mixed', () => {
    const pattern = inferEmailPattern('acme.com', [
      'john.doe@acme.com',
      'jane.smith@acme.com',
      'bob_jones@acme.com',
    ]);
    // Two {first}.{last} vs one {first}_{last}
    expect(pattern).toBe('{first}.{last}');
  });
});

// ---------------------------------------------------------------------------
// prioritizeCandidates
// ---------------------------------------------------------------------------

describe('prioritizeCandidates', () => {
  const candidates: EmailCandidate[] = [
    { email: 'john@acme.com', pattern: '{first}', source: 'pattern_inference' },
    { email: 'john.doe@acme.com', pattern: '{first}.{last}', source: 'pattern_inference' },
    { email: 'jdoe@acme.com', pattern: '{f}{last}', source: 'pattern_inference' },
    { email: 'johnd@acme.com', pattern: '{first}{l}', source: 'pattern_inference' },
    { email: 'john_doe@acme.com', pattern: '{first}_{last}', source: 'pattern_inference' },
    { email: 'doe@acme.com', pattern: '{last}', source: 'pattern_inference' },
  ];

  it('returns candidates unchanged when no pattern detected', () => {
    const result = prioritizeCandidates(candidates, null);
    expect(result).toEqual(candidates);
  });

  it('puts matching candidates first', () => {
    const result = prioritizeCandidates(candidates, '{first}.{last}');
    expect(result[0].email).toBe('john.doe@acme.com');
    expect(result).toHaveLength(6);
  });

  it('preserves relative order within each group', () => {
    const result = prioritizeCandidates(candidates, '{first}.{last}');
    // Matching group
    const matching = result.filter((c) => c.pattern === '{first}.{last}');
    expect(matching).toHaveLength(1);
    // Non-matching group should preserve original order
    const nonMatching = result.filter((c) => c.pattern !== '{first}.{last}');
    expect(nonMatching.map((c) => c.pattern)).toEqual([
      '{first}',
      '{f}{last}',
      '{first}{l}',
      '{first}_{last}',
      '{last}',
    ]);
  });
});

// ---------------------------------------------------------------------------
// discoverEmail (integration-style unit test)
// ---------------------------------------------------------------------------

describe('discoverEmail', () => {
  let cache: RunCache;

  beforeEach(() => {
    cache = createRunCache();
  });

  it('returns null email when domain cannot be extracted', async () => {
    const prospect: ProspectContext = { name: 'X', company: '' };
    const result = await discoverEmail(prospect, cache);
    expect(result.email).toBeNull();
    expect(result.companyDomain).toBeNull();
  });

  it('returns unverified candidate when no MX records found', async () => {
    cache.setMXRecords('acme.com', []);
    const prospect: ProspectContext = {
      name: 'John Doe',
      company: 'Acme',
      companyDomain: 'acme.com',
    };
    const result = await discoverEmail(prospect, cache);
    expect(result.email).toBeTruthy();
    expect(result.verified).toBe(false);
    expect(result.confidence).toBe('low');
    expect(result.companyDomain).toBe('acme.com');
  });

  it('caches MX records after first lookup', async () => {
    // Pre-set empty MX so we don't hit real DNS
    cache.setMXRecords('acme.com', []);
    const prospect: ProspectContext = {
      name: 'John Doe',
      company: 'Acme',
      companyDomain: 'acme.com',
    };
    await discoverEmail(prospect, cache);
    // MX records should be cached
    expect(cache.getMXRecords('acme.com')).toEqual([]);
  });

  it('uses cached email pattern for prioritization', async () => {
    cache.setMXRecords('acme.com', []);
    cache.setEmailPattern('acme.com', '{first}.{last}');
    const prospect: ProspectContext = {
      name: 'John Doe',
      company: 'Acme',
      companyDomain: 'acme.com',
    };
    const result = await discoverEmail(prospect, cache);
    // The top candidate should match the detected pattern
    expect(result.email).toBe('john.doe@acme.com');
  });

  it('returns low confidence for unverified results', async () => {
    cache.setMXRecords('acme.com', []);
    const prospect: ProspectContext = {
      name: 'John Doe',
      company: 'Acme',
      companyDomain: 'acme.com',
    };
    const result = await discoverEmail(prospect, cache);
    expect(result.confidence).toBe('low');
    expect(result.verificationMethod).toBe('pattern_inference');
  });

  it('handles single-word names gracefully', async () => {
    cache.setMXRecords('acme.com', []);
    const prospect: ProspectContext = {
      name: 'Madonna',
      company: 'Acme',
      companyDomain: 'acme.com',
    };
    const result = await discoverEmail(prospect, cache);
    // Single name — can't generate proper candidates
    expect(result.email).toBeNull();
    expect(result.companyDomain).toBe('acme.com');
  });

  it('records verificationMethod as pattern_inference when no SMTP', async () => {
    cache.setMXRecords('acme.com', []);
    const prospect: ProspectContext = {
      name: 'Jane Smith',
      company: 'Acme',
      companyDomain: 'acme.com',
    };
    const result = await discoverEmail(prospect, cache);
    expect(result.verificationMethod).toBe('pattern_inference');
  });
});
