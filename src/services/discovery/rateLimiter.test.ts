import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _getDailyCount,
  _resetForTesting,
  acquirePermit,
  applyBackoff,
  getStatus,
  isDailyBudgetExhausted,
  recordRequest,
} from './rateLimiter';

describe('rateLimiter', () => {
  beforeEach(() => {
    _resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('acquirePermit', () => {
    it('should allow requests within the rate limit', async () => {
      // Default google limit is 10/min
      await acquirePermit('google');
      const status = getStatus('google');
      expect(status.currentMinuteCount).toBe(1);
    });

    it('should allow multiple requests up to the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await acquirePermit('linkedin');
      }
      const status = getStatus('linkedin');
      // linkedin default is 5/min, so 5 requests should fill the window
      expect(status.currentMinuteCount).toBe(5);
    });

    it('should throw when daily budget is exhausted', async () => {
      // Set a very small daily budget via env
      process.env.DAILY_BUDGET_PER_SOURCE = '2';
      _resetForTesting();

      recordRequest('google');
      recordRequest('google');

      await expect(acquirePermit('google')).rejects.toThrow(
        'Daily budget exhausted for source "google"',
      );

      delete process.env.DAILY_BUDGET_PER_SOURCE;
    });
  });

  describe('recordRequest', () => {
    it('should increment the daily counter', () => {
      expect(_getDailyCount('google')).toBe(0);
      recordRequest('google');
      expect(_getDailyCount('google')).toBe(1);
      recordRequest('google');
      expect(_getDailyCount('google')).toBe(2);
    });

    it('should track counts independently per source', () => {
      recordRequest('google');
      recordRequest('google');
      recordRequest('linkedin');

      expect(_getDailyCount('google')).toBe(2);
      expect(_getDailyCount('linkedin')).toBe(1);
      expect(_getDailyCount('github')).toBe(0);
    });
  });

  describe('isDailyBudgetExhausted', () => {
    it('should return false when under budget', () => {
      expect(isDailyBudgetExhausted('google')).toBe(false);
    });

    it('should return true when budget is reached', () => {
      process.env.DAILY_BUDGET_PER_SOURCE = '3';
      _resetForTesting();

      recordRequest('google');
      recordRequest('google');
      expect(isDailyBudgetExhausted('google')).toBe(false);

      recordRequest('google');
      expect(isDailyBudgetExhausted('google')).toBe(true);

      delete process.env.DAILY_BUDGET_PER_SOURCE;
    });
  });

  describe('applyBackoff', () => {
    it('should set backoff for consecutive failures', () => {
      applyBackoff('google', 1);
      const status = getStatus('google');
      expect(status.backoffUntil).not.toBeNull();
    });

    it('should clear backoff when consecutiveFailures is 0', () => {
      applyBackoff('google', 3);
      applyBackoff('google', 0);
      const status = getStatus('google');
      expect(status.backoffUntil).toBeNull();
    });

    it('should compute correct backoff durations', () => {
      // N=1: min(10 * 2^0, 600) = 10s
      const now = Date.now();
      applyBackoff('test1', 1);
      const s1 = getStatus('test1');
      expect(s1.backoffUntil).not.toBeNull();
      const diff1 = s1.backoffUntil!.getTime() - now;
      expect(diff1).toBeGreaterThanOrEqual(9_000);
      expect(diff1).toBeLessThanOrEqual(11_000);

      // N=2: min(10 * 2^1, 600) = 20s
      applyBackoff('test2', 2);
      const s2 = getStatus('test2');
      const diff2 = s2.backoffUntil!.getTime() - now;
      expect(diff2).toBeGreaterThanOrEqual(19_000);
      expect(diff2).toBeLessThanOrEqual(21_000);

      // N=3: min(10 * 2^2, 600) = 40s
      applyBackoff('test3', 3);
      const s3 = getStatus('test3');
      const diff3 = s3.backoffUntil!.getTime() - now;
      expect(diff3).toBeGreaterThanOrEqual(39_000);
      expect(diff3).toBeLessThanOrEqual(41_000);
    });

    it('should cap backoff at 600 seconds', () => {
      const now = Date.now();
      // N=10: min(10 * 2^9, 600) = min(5120, 600) = 600s
      applyBackoff('capped', 10);
      const status = getStatus('capped');
      const diff = status.backoffUntil!.getTime() - now;
      expect(diff).toBeGreaterThanOrEqual(599_000);
      expect(diff).toBeLessThanOrEqual(601_000);
    });
  });

  describe('getStatus', () => {
    it('should return correct initial status', () => {
      const status = getStatus('google');
      expect(status.source).toBe('google');
      expect(status.currentMinuteCount).toBe(0);
      expect(status.minuteLimit).toBe(10);
      expect(status.dailyCount).toBe(0);
      expect(status.dailyLimit).toBe(500);
      expect(status.isExhausted).toBe(false);
      expect(status.backoffUntil).toBeNull();
    });

    it('should reflect correct limits per source', () => {
      expect(getStatus('google').minuteLimit).toBe(10);
      expect(getStatus('linkedin').minuteLimit).toBe(5);
      expect(getStatus('github').minuteLimit).toBe(15);
      expect(getStatus('twitter').minuteLimit).toBe(5);
      expect(getStatus('smtp').minuteLimit).toBe(20);
    });

    it('should read rate limits from env vars', () => {
      process.env.GOOGLE_RATE_LIMIT = '25';
      _resetForTesting();

      const status = getStatus('google');
      expect(status.minuteLimit).toBe(25);

      delete process.env.GOOGLE_RATE_LIMIT;
    });

    it('should reflect daily count after recording requests', () => {
      recordRequest('google');
      recordRequest('google');
      recordRequest('google');

      const status = getStatus('google');
      expect(status.dailyCount).toBe(3);
    });
  });
});
