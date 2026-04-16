import type { OutreachStrategy, PipelineConfig } from '@/types';
import { describe, expect, it } from 'vitest';
import { extractStrategy, formatStrategyForPrompt } from './strategyService';

// ---------------------------------------------------------------------------
// extractStrategy — pure function tests
// ---------------------------------------------------------------------------

describe('extractStrategy', () => {
  const baseConfig: PipelineConfig = {
    founderId: 'f1',
    runIntervalMinutes: 60,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    businessDays: [1, 2, 3, 4, 5],
    timezone: 'America/New_York',
    dailyDiscoveryCap: 50,
    minLeadScore: 50,
    maxFollowUps: 3,
    sequenceCadenceDays: [3, 5, 7],
    tonePreference: 'professional',
    productContext: 'AI sales tool',
    valueProposition: 'Automates outreach',
    targetPainPoints: ['manual outreach', 'low reply rates'],
  };

  it('extracts only strategy fields from a full config', () => {
    const strategy = extractStrategy(baseConfig);
    expect(strategy).toEqual({
      productContext: 'AI sales tool',
      valueProposition: 'Automates outreach',
      targetPainPoints: ['manual outreach', 'low reply rates'],
      tonePreference: 'professional',
    });
  });

  it('handles empty strategy fields', () => {
    const config: PipelineConfig = {
      ...baseConfig,
      productContext: '',
      valueProposition: '',
      targetPainPoints: [],
      tonePreference: 'casual',
    };
    const strategy = extractStrategy(config);
    expect(strategy).toEqual({
      productContext: '',
      valueProposition: '',
      targetPainPoints: [],
      tonePreference: 'casual',
    });
  });
});

// ---------------------------------------------------------------------------
// formatStrategyForPrompt — pure function tests
// ---------------------------------------------------------------------------

describe('formatStrategyForPrompt', () => {
  it('formats a complete strategy into a prompt string', () => {
    const strategy: OutreachStrategy = {
      productContext: 'AI sales tool for B2B SaaS',
      valueProposition: 'Automates outreach and books meetings',
      targetPainPoints: ['manual outreach', 'low reply rates'],
      tonePreference: 'professional',
    };

    const result = formatStrategyForPrompt(strategy);

    expect(result).toContain('Product Context: AI sales tool for B2B SaaS');
    expect(result).toContain('Value Proposition: Automates outreach and books meetings');
    expect(result).toContain('Target Pain Points: manual outreach; low reply rates');
    expect(result).toContain('Tone: professional');
  });

  it('handles empty pain points', () => {
    const strategy: OutreachStrategy = {
      productContext: 'Some product',
      valueProposition: 'Some value',
      targetPainPoints: [],
      tonePreference: 'direct',
    };

    const result = formatStrategyForPrompt(strategy);

    expect(result).toContain('Target Pain Points: (none specified)');
    expect(result).toContain('Tone: direct');
  });

  it('handles a single pain point', () => {
    const strategy: OutreachStrategy = {
      productContext: 'CRM',
      valueProposition: 'Better pipeline',
      targetPainPoints: ['data entry'],
      tonePreference: 'casual',
    };

    const result = formatStrategyForPrompt(strategy);

    expect(result).toContain('Target Pain Points: data entry');
  });

  it('includes all four sections as separate lines', () => {
    const strategy: OutreachStrategy = {
      productContext: 'P',
      valueProposition: 'V',
      targetPainPoints: ['A'],
      tonePreference: 'professional',
    };

    const lines = formatStrategyForPrompt(strategy).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Product Context:/);
    expect(lines[1]).toMatch(/^Value Proposition:/);
    expect(lines[2]).toMatch(/^Target Pain Points:/);
    expect(lines[3]).toMatch(/^Tone:/);
  });
});
