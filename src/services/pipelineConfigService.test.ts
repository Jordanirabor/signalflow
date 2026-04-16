import { describe, expect, it } from 'vitest';
import { validatePipelineConfig } from './pipelineConfigService';

describe('validatePipelineConfig', () => {
  it('accepts valid config with all fields within range', () => {
    const result = validatePipelineConfig({
      runIntervalMinutes: 60,
      dailyDiscoveryCap: 50,
      maxFollowUps: 3,
      minLeadScore: 50,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('accepts config at lower bounds', () => {
    const result = validatePipelineConfig({
      runIntervalMinutes: 15,
      dailyDiscoveryCap: 10,
      maxFollowUps: 1,
      minLeadScore: 30,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('accepts config at upper bounds', () => {
    const result = validatePipelineConfig({
      runIntervalMinutes: 240,
      dailyDiscoveryCap: 200,
      maxFollowUps: 5,
      minLeadScore: 90,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('rejects runIntervalMinutes below 15', () => {
    const result = validatePipelineConfig({ runIntervalMinutes: 14 });
    expect(result.valid).toBe(false);
    expect(result.errors.runIntervalMinutes).toBeDefined();
  });

  it('rejects runIntervalMinutes above 240', () => {
    const result = validatePipelineConfig({ runIntervalMinutes: 241 });
    expect(result.valid).toBe(false);
    expect(result.errors.runIntervalMinutes).toBeDefined();
  });

  it('rejects dailyDiscoveryCap below 10', () => {
    const result = validatePipelineConfig({ dailyDiscoveryCap: 9 });
    expect(result.valid).toBe(false);
    expect(result.errors.dailyDiscoveryCap).toBeDefined();
  });

  it('rejects dailyDiscoveryCap above 200', () => {
    const result = validatePipelineConfig({ dailyDiscoveryCap: 201 });
    expect(result.valid).toBe(false);
    expect(result.errors.dailyDiscoveryCap).toBeDefined();
  });

  it('rejects maxFollowUps below 1', () => {
    const result = validatePipelineConfig({ maxFollowUps: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.maxFollowUps).toBeDefined();
  });

  it('rejects maxFollowUps above 5', () => {
    const result = validatePipelineConfig({ maxFollowUps: 6 });
    expect(result.valid).toBe(false);
    expect(result.errors.maxFollowUps).toBeDefined();
  });

  it('rejects minLeadScore below 30', () => {
    const result = validatePipelineConfig({ minLeadScore: 29 });
    expect(result.valid).toBe(false);
    expect(result.errors.minLeadScore).toBeDefined();
  });

  it('rejects minLeadScore above 90', () => {
    const result = validatePipelineConfig({ minLeadScore: 91 });
    expect(result.valid).toBe(false);
    expect(result.errors.minLeadScore).toBeDefined();
  });

  it('returns multiple errors when multiple fields are invalid', () => {
    const result = validatePipelineConfig({
      runIntervalMinutes: 5,
      dailyDiscoveryCap: 500,
      maxFollowUps: 0,
      minLeadScore: 10,
    });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors)).toHaveLength(4);
    expect(result.errors.runIntervalMinutes).toBeDefined();
    expect(result.errors.dailyDiscoveryCap).toBeDefined();
    expect(result.errors.maxFollowUps).toBeDefined();
    expect(result.errors.minLeadScore).toBeDefined();
  });

  it('rejects non-integer values', () => {
    const result = validatePipelineConfig({
      runIntervalMinutes: 60.5,
      dailyDiscoveryCap: 50.1,
      maxFollowUps: 2.5,
      minLeadScore: 50.9,
    });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors)).toHaveLength(4);
  });

  it('accepts config with no validated fields (partial update)', () => {
    const result = validatePipelineConfig({
      tonePreference: 'casual',
      productContext: 'some context',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('accepts empty config', () => {
    const result = validatePipelineConfig({});
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });
});
