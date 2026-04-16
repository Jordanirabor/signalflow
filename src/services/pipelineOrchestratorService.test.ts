import type { PipelineConfig } from '@/types';
import { describe, expect, it } from 'vitest';
import {
  computeNextRunTime,
  isFollowUpDue,
  shouldCloseNoResponse,
} from './pipelineOrchestratorService';

// ---------------------------------------------------------------------------
// Helper: build a config with defaults, overriding specific fields
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    founderId: '00000000-0000-0000-0000-000000000001',
    runIntervalMinutes: 60,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    businessDays: [1, 2, 3, 4, 5], // Mon–Fri
    timezone: 'America/New_York',
    dailyDiscoveryCap: 50,
    minLeadScore: 50,
    maxFollowUps: 3,
    sequenceCadenceDays: [3, 5, 7],
    tonePreference: 'professional',
    productContext: '',
    valueProposition: '',
    targetPainPoints: [],
    ...overrides,
  };
}

describe('computeNextRunTime', () => {
  it('returns lastRunTime + interval when result is within business hours on a business day', () => {
    const config = makeConfig({ runIntervalMinutes: 60 });
    // Monday 10:00 AM + 60 min = Monday 11:00 AM (within business hours)
    const lastRun = new Date('2025-01-06T10:00:00'); // Monday
    const next = computeNextRunTime(config, lastRun);
    expect(next.getTime()).toBe(new Date('2025-01-06T11:00:00').getTime());
  });

  it('snaps to next business day start when interval pushes past business hours end', () => {
    const config = makeConfig({ runIntervalMinutes: 60 });
    // Monday 16:30 + 60 min = Monday 17:30 (past 17:00 end)
    const lastRun = new Date('2025-01-06T16:30:00'); // Monday
    const next = computeNextRunTime(config, lastRun);
    // Should be Tuesday 09:00
    expect(next.getTime()).toBe(new Date('2025-01-07T09:00:00').getTime());
  });

  it('snaps to business hours start when candidate is before business hours', () => {
    const config = makeConfig({ runIntervalMinutes: 60 });
    // Monday 07:00 + 60 min = Monday 08:00 (before 09:00 start)
    const lastRun = new Date('2025-01-06T07:00:00'); // Monday
    const next = computeNextRunTime(config, lastRun);
    expect(next.getTime()).toBe(new Date('2025-01-06T09:00:00').getTime());
  });

  it('skips weekends to next Monday', () => {
    const config = makeConfig({ runIntervalMinutes: 60 });
    // Friday 16:30 + 60 min = Friday 17:30 (past end) → skip Sat/Sun → Monday 09:00
    const lastRun = new Date('2025-01-10T16:30:00'); // Friday
    const next = computeNextRunTime(config, lastRun);
    expect(next.getTime()).toBe(new Date('2025-01-13T09:00:00').getTime());
  });

  it('handles Saturday last run time', () => {
    const config = makeConfig({ runIntervalMinutes: 60 });
    // Saturday 12:00 + 60 min = Saturday 13:00 (not a business day) → Monday 09:00
    const lastRun = new Date('2025-01-11T12:00:00'); // Saturday
    const next = computeNextRunTime(config, lastRun);
    expect(next.getTime()).toBe(new Date('2025-01-13T09:00:00').getTime());
  });

  it('handles Sunday last run time', () => {
    const config = makeConfig({ runIntervalMinutes: 60 });
    // Sunday 12:00 + 60 min = Sunday 13:00 (not a business day) → Monday 09:00
    const lastRun = new Date('2025-01-12T12:00:00'); // Sunday
    const next = computeNextRunTime(config, lastRun);
    expect(next.getTime()).toBe(new Date('2025-01-13T09:00:00').getTime());
  });

  it('respects custom business hours', () => {
    const config = makeConfig({
      runIntervalMinutes: 30,
      businessHoursStart: '10:00',
      businessHoursEnd: '14:00',
    });
    // Monday 08:00 + 30 min = Monday 08:30 (before 10:00 start)
    const lastRun = new Date('2025-01-06T08:00:00');
    const next = computeNextRunTime(config, lastRun);
    expect(next.getTime()).toBe(new Date('2025-01-06T10:00:00').getTime());
  });

  it('respects custom business days', () => {
    // Only Tue, Thu, Sat
    const config = makeConfig({
      runIntervalMinutes: 60,
      businessDays: [2, 4, 6],
    });
    // Monday 10:00 + 60 min = Monday 11:00 (Mon not a business day) → Tuesday 09:00
    const lastRun = new Date('2025-01-06T10:00:00'); // Monday
    const next = computeNextRunTime(config, lastRun);
    expect(next.getTime()).toBe(new Date('2025-01-07T09:00:00').getTime());
  });

  it('handles exactly at business hours end', () => {
    const config = makeConfig({ runIntervalMinutes: 60 });
    // Monday 16:00 + 60 min = Monday 17:00 (exactly at end, which is >= end)
    const lastRun = new Date('2025-01-06T16:00:00');
    const next = computeNextRunTime(config, lastRun);
    // 17:00 is >= bhEnd, so advance to next business day
    expect(next.getTime()).toBe(new Date('2025-01-07T09:00:00').getTime());
  });

  it('handles short interval within business hours', () => {
    const config = makeConfig({ runIntervalMinutes: 15 });
    // Monday 09:00 + 15 min = Monday 09:15
    const lastRun = new Date('2025-01-06T09:00:00');
    const next = computeNextRunTime(config, lastRun);
    expect(next.getTime()).toBe(new Date('2025-01-06T09:15:00').getTime());
  });

  it('returns a time strictly after lastRunTime', () => {
    const config = makeConfig({ runIntervalMinutes: 15 });
    const lastRun = new Date('2025-01-06T10:00:00');
    const next = computeNextRunTime(config, lastRun);
    expect(next.getTime()).toBeGreaterThan(lastRun.getTime());
  });
});

// ---------------------------------------------------------------------------
// isFollowUpDue
// ---------------------------------------------------------------------------

describe('isFollowUpDue', () => {
  it('returns true when elapsed time equals cadence interval exactly', () => {
    const lastMessage = new Date('2025-01-06T10:00:00');
    const now = new Date('2025-01-09T10:00:00'); // exactly 3 days later
    expect(isFollowUpDue(lastMessage, 3, now)).toBe(true);
  });

  it('returns true when elapsed time exceeds cadence interval', () => {
    const lastMessage = new Date('2025-01-06T10:00:00');
    const now = new Date('2025-01-12T10:00:00'); // 6 days later, cadence is 3
    expect(isFollowUpDue(lastMessage, 3, now)).toBe(true);
  });

  it('returns false when elapsed time is less than cadence interval', () => {
    const lastMessage = new Date('2025-01-06T10:00:00');
    const now = new Date('2025-01-08T09:00:00'); // ~2 days later, cadence is 3
    expect(isFollowUpDue(lastMessage, 3, now)).toBe(false);
  });

  it('returns false when now equals lastMessageDate (0 elapsed)', () => {
    const lastMessage = new Date('2025-01-06T10:00:00');
    expect(isFollowUpDue(lastMessage, 1, lastMessage)).toBe(false);
  });

  it('handles cadence of 0 days (always due)', () => {
    const lastMessage = new Date('2025-01-06T10:00:00');
    const now = new Date('2025-01-06T10:00:00');
    expect(isFollowUpDue(lastMessage, 0, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldCloseNoResponse
// ---------------------------------------------------------------------------

describe('shouldCloseNoResponse', () => {
  it('returns true when follow-up count equals max and no reply', () => {
    expect(shouldCloseNoResponse(3, 3, false)).toBe(true);
  });

  it('returns true when follow-up count exceeds max and no reply', () => {
    expect(shouldCloseNoResponse(5, 3, false)).toBe(true);
  });

  it('returns false when follow-up count is below max', () => {
    expect(shouldCloseNoResponse(2, 3, false)).toBe(false);
  });

  it('returns false when prospect has replied even if count >= max', () => {
    expect(shouldCloseNoResponse(3, 3, true)).toBe(false);
  });

  it('returns false when count is 0 and max is 1', () => {
    expect(shouldCloseNoResponse(0, 1, false)).toBe(false);
  });

  it('returns true when count is 1 and max is 1 and no reply', () => {
    expect(shouldCloseNoResponse(1, 1, false)).toBe(true);
  });
});
