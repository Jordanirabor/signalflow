// ============================================================
// Sliding-Window Rate Limiter with Daily Budget Enforcement
// ============================================================

import type { RateLimiterConfig, RateLimitStatus } from './types';

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/** Per-source sliding window: array of request timestamps (ms) */
const windowTimestamps = new Map<string, number[]>();

/** Per-source daily request count */
const dailyCounts = new Map<string, number>();

/** Date string (YYYY-MM-DD) of the current tracking day */
let currentDay: string = todayString();

/** Per-source backoff-until timestamp (ms) */
const backoffUntilMap = new Map<string, number>();

/** Per-source configuration */
const sourceConfigs = new Map<string, RateLimiterConfig>();

// ---------------------------------------------------------------------------
// Default Rate Limits (overridable via env vars)
// ---------------------------------------------------------------------------

const DEFAULT_LIMITS: Record<string, { rpm: number; envVar: string }> = {
  google: { rpm: 10, envVar: 'GOOGLE_RATE_LIMIT' },
  linkedin: { rpm: 5, envVar: 'LINKEDIN_RATE_LIMIT' },
  github: { rpm: 15, envVar: 'GITHUB_RATE_LIMIT' },
  twitter: { rpm: 5, envVar: 'TWITTER_RATE_LIMIT' },
  smtp: { rpm: 20, envVar: 'SMTP_RATE_LIMIT' },
};

const DAILY_BUDGET_ENV = 'DAILY_BUDGET_PER_SOURCE';
const DEFAULT_DAILY_BUDGET = 500;

/** Maximum backoff cap in seconds */
const MAX_BACKOFF_SECONDS = 600;

/** Base backoff in seconds for exponential calculation */
const BASE_BACKOFF_SECONDS = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig(source: string): RateLimiterConfig {
  const cached = sourceConfigs.get(source);
  if (cached) return cached;

  const key = source.toLowerCase();
  const defaults = DEFAULT_LIMITS[key];
  const rpm = defaults
    ? readEnvInt(defaults.envVar, defaults.rpm)
    : readEnvInt(`${key.toUpperCase()}_RATE_LIMIT`, 10);
  const dailyBudget = readEnvInt(DAILY_BUDGET_ENV, DEFAULT_DAILY_BUDGET);

  const config: RateLimiterConfig = {
    source,
    requestsPerMinute: rpm,
    dailyBudget,
  };
  sourceConfigs.set(source, config);
  return config;
}

// ---------------------------------------------------------------------------
// Daily Budget Reset
// ---------------------------------------------------------------------------

function resetDailyIfNeeded(): void {
  const today = todayString();
  if (today !== currentDay) {
    dailyCounts.clear();
    currentDay = today;
    console.log(`[RateLimiter] Daily counters reset for new day: ${today}`);
  }
}

// ---------------------------------------------------------------------------
// Sliding Window Helpers
// ---------------------------------------------------------------------------

/** Prune timestamps older than 60 seconds from the window. */
function pruneWindow(source: string, now: number): number[] {
  const timestamps = windowTimestamps.get(source) ?? [];
  const cutoff = now - 60_000;
  const pruned = timestamps.filter((t) => t > cutoff);
  windowTimestamps.set(source, pruned);
  return pruned;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Acquire a permit for the given source. Blocks (delays) until the sliding
 * window has capacity and the daily budget is not exhausted.
 * Does NOT drop requests — it waits.
 */
export async function acquirePermit(source: string): Promise<void> {
  resetDailyIfNeeded();

  const config = getConfig(source);

  // Check daily budget
  if (isDailyBudgetExhausted(source)) {
    console.log(
      `[RateLimiter] Daily budget exhausted for "${source}". ` +
        `Count: ${dailyCounts.get(source) ?? 0}, Limit: ${config.dailyBudget}`,
    );
    throw new Error(`Daily budget exhausted for source "${source}"`);
  }

  // Wait for any active backoff to expire
  const backoffUntil = backoffUntilMap.get(source) ?? 0;
  const now = Date.now();
  if (backoffUntil > now) {
    const waitMs = backoffUntil - now;
    console.log(
      `[RateLimiter] Backoff active for "${source}". ` + `Waiting ${(waitMs / 1000).toFixed(1)}s`,
    );
    await sleep(waitMs);
  }

  // Sliding window enforcement — loop until we have capacity
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const currentTime = Date.now();
    const window = pruneWindow(source, currentTime);

    if (window.length < config.requestsPerMinute) {
      // Capacity available — record the timestamp and proceed
      window.push(currentTime);
      windowTimestamps.set(source, window);
      break;
    }

    // Window full — sleep until the oldest timestamp exits the 60s window
    const oldestTimestamp = window[0];
    const sleepMs = oldestTimestamp + 60_000 - currentTime + 1; // +1ms buffer

    console.log(
      `[RateLimiter] Rate limit reached for "${source}". ` +
        `Count: ${window.length}, Limit: ${config.requestsPerMinute}. ` +
        `Waiting ${(sleepMs / 1000).toFixed(1)}s`,
    );

    await sleep(Math.max(sleepMs, 0));
  }
}

/**
 * Record a completed request for the given source.
 * Increments the daily counter.
 */
export function recordRequest(source: string): void {
  resetDailyIfNeeded();
  const prev = dailyCounts.get(source) ?? 0;
  dailyCounts.set(source, prev + 1);
}

/**
 * Check whether the daily budget for a source is exhausted.
 */
export function isDailyBudgetExhausted(source: string): boolean {
  resetDailyIfNeeded();
  const config = getConfig(source);
  const count = dailyCounts.get(source) ?? 0;
  return count >= config.dailyBudget;
}

/**
 * Apply exponential backoff for a source after HTTP 429 responses.
 * Formula: min(10 * 2^(N-1), 600) seconds, where N = consecutiveFailures.
 */
export function applyBackoff(source: string, consecutiveFailures: number): void {
  if (consecutiveFailures <= 0) {
    backoffUntilMap.delete(source);
    return;
  }

  const backoffSeconds = Math.min(
    BASE_BACKOFF_SECONDS * Math.pow(2, consecutiveFailures - 1),
    MAX_BACKOFF_SECONDS,
  );
  const backoffMs = backoffSeconds * 1000;
  const until = new Date(Date.now() + backoffMs);

  backoffUntilMap.set(source, until.getTime());

  console.log(
    `[RateLimiter] Backoff applied for "${source}". ` +
      `Consecutive 429s: ${consecutiveFailures}, ` +
      `Backoff: ${backoffSeconds}s, Until: ${until.toISOString()}`,
  );
}

/**
 * Get the current rate limit status for a source.
 */
export function getStatus(source: string): RateLimitStatus {
  resetDailyIfNeeded();
  const config = getConfig(source);
  const now = Date.now();
  const window = pruneWindow(source, now);
  const dailyCount = dailyCounts.get(source) ?? 0;
  const backoffUntil = backoffUntilMap.get(source) ?? 0;

  return {
    source,
    currentMinuteCount: window.length,
    minuteLimit: config.requestsPerMinute,
    dailyCount,
    dailyLimit: config.dailyBudget,
    isExhausted: dailyCount >= config.dailyBudget,
    backoffUntil: backoffUntil > now ? new Date(backoffUntil) : null,
  };
}

// ---------------------------------------------------------------------------
// Testing Utilities (exported for test access only)
// ---------------------------------------------------------------------------

/** Reset all internal state. Useful for tests. */
export function _resetForTesting(): void {
  windowTimestamps.clear();
  dailyCounts.clear();
  backoffUntilMap.clear();
  sourceConfigs.clear();
  currentDay = todayString();
}

/** Expose internal window timestamps for test assertions. */
export function _getWindowTimestamps(source: string): number[] {
  return windowTimestamps.get(source) ?? [];
}

/** Expose internal daily counts for test assertions. */
export function _getDailyCount(source: string): number {
  return dailyCounts.get(source) ?? 0;
}
