import { describe, expect, it } from 'vitest';
import { validateBuyingSignals, validateICPProfile, validatePainPoints } from './icpProfileService';

describe('validatePainPoints', () => {
  it('accepts 1 valid pain point', () => {
    const result = validatePainPoints(['Slow deployments']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts 10 valid pain points', () => {
    const points = Array.from({ length: 10 }, (_, i) => `Pain point ${i + 1}`);
    const result = validatePainPoints(points);
    expect(result.valid).toBe(true);
  });

  it('rejects empty array', () => {
    const result = validatePainPoints([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/at least 1/);
  });

  it('rejects more than 10 entries', () => {
    const points = Array.from({ length: 11 }, (_, i) => `Point ${i}`);
    const result = validatePainPoints(points);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/at most 10/);
  });

  it('rejects empty string entries', () => {
    const result = validatePainPoints(['valid', '']);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/non-empty/);
  });

  it('rejects whitespace-only entries', () => {
    const result = validatePainPoints(['   ']);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/non-empty/);
  });

  it('rejects entries exceeding 200 characters', () => {
    const longStr = 'a'.repeat(201);
    const result = validatePainPoints([longStr]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/exceeds 200/);
  });

  it('accepts entry exactly 200 characters', () => {
    const result = validatePainPoints(['a'.repeat(200)]);
    expect(result.valid).toBe(true);
  });
});

describe('validateBuyingSignals', () => {
  it('accepts 1 valid buying signal', () => {
    const result = validateBuyingSignals(['Hiring DevOps engineers']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts 5 valid buying signals', () => {
    const signals = Array.from({ length: 5 }, (_, i) => `Signal ${i + 1}`);
    const result = validateBuyingSignals(signals);
    expect(result.valid).toBe(true);
  });

  it('rejects empty array', () => {
    const result = validateBuyingSignals([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/at least 1/);
  });

  it('rejects more than 5 entries', () => {
    const signals = Array.from({ length: 6 }, (_, i) => `Signal ${i}`);
    const result = validateBuyingSignals(signals);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/at most 5/);
  });

  it('rejects empty string entries', () => {
    const result = validateBuyingSignals(['valid', '']);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/non-empty/);
  });

  it('rejects entries exceeding 200 characters', () => {
    const longStr = 'b'.repeat(201);
    const result = validateBuyingSignals([longStr]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/exceeds 200/);
  });

  it('accepts entry exactly 200 characters', () => {
    const result = validateBuyingSignals(['b'.repeat(200)]);
    expect(result.valid).toBe(true);
  });
});

describe('validateICPProfile', () => {
  const validInput = {
    targetRole: 'VP of Engineering',
    industry: 'SaaS',
    painPoints: ['Slow CI/CD pipelines'],
    buyingSignals: ['Hiring DevOps'],
  };

  it('accepts a valid profile input', () => {
    const result = validateICPProfile(validInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing targetRole', () => {
    const result = validateICPProfile({ ...validInput, targetRole: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('targetRole is required');
  });

  it('rejects empty targetRole', () => {
    const result = validateICPProfile({ ...validInput, targetRole: '  ' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('targetRole is required');
  });

  it('rejects missing industry', () => {
    const result = validateICPProfile({ ...validInput, industry: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('industry is required');
  });

  it('rejects empty industry', () => {
    const result = validateICPProfile({ ...validInput, industry: '' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('industry is required');
  });

  it('rejects zero painPoints', () => {
    const result = validateICPProfile({ ...validInput, painPoints: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('At least 1 painPoint is required');
  });

  it('rejects missing painPoints', () => {
    const result = validateICPProfile({ ...validInput, painPoints: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('At least 1 painPoint is required');
  });

  it('collects multiple errors at once', () => {
    const result = validateICPProfile({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts profile without buyingSignals', () => {
    const { buyingSignals, ...noBuyingSignals } = validInput;
    const result = validateICPProfile(noBuyingSignals);
    expect(result.valid).toBe(true);
  });

  it('validates buyingSignals when provided', () => {
    const result = validateICPProfile({
      ...validInput,
      buyingSignals: Array.from({ length: 6 }, (_, i) => `Signal ${i}`),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at most 5'))).toBe(true);
  });

  it('validates painPoints content through delegation', () => {
    const result = validateICPProfile({
      ...validInput,
      painPoints: ['valid', 'a'.repeat(201)],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds 200'))).toBe(true);
  });
});
