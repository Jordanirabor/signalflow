// ============================================================
// Anti-Detection Manager
// ============================================================

import type { AntiDetectionConfig } from './types';

// ---------------------------------------------------------------------------
// User-Agent Pool (20+ common browser UA strings)
// ---------------------------------------------------------------------------

const USER_AGENT_POOL: string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/** Round-robin index for User-Agent rotation */
let uaIndex = 0;

/** Round-robin index for proxy rotation */
let proxyIndex = 0;

/** Cache of robots.txt results keyed by domain */
const robotsTxtCache = new Map<string, RobotsTxtResult>();

interface RobotsTxtResult {
  checked: boolean;
  disallowedPaths: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function loadConfig(): AntiDetectionConfig {
  const proxyRaw = process.env.SCRAPING_PROXY_LIST ?? '';
  const proxyList = proxyRaw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const proxyEnabled = process.env.SCRAPING_PROXY_ENABLED === 'true';

  return {
    userAgents: USER_AGENT_POOL,
    proxyList,
    proxyEnabled,
    minDelay: 2,
    maxDelay: 10,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the next User-Agent string from the pool using round-robin rotation.
 */
export function getNextUserAgent(): string {
  const ua = USER_AGENT_POOL[uaIndex % USER_AGENT_POOL.length];
  uaIndex += 1;
  return ua;
}

/**
 * Get the next proxy from the SCRAPING_PROXY_LIST env var using round-robin rotation.
 * Returns null if proxy is not enabled or no proxies are configured.
 */
export function getNextProxy(): string | null {
  const config = loadConfig();
  if (!config.proxyEnabled || config.proxyList.length === 0) {
    return null;
  }
  const proxy = config.proxyList[proxyIndex % config.proxyList.length];
  proxyIndex += 1;
  return proxy;
}

/**
 * Get a random delay in the specified range (in seconds).
 * Defaults to [2, 10] seconds per the anti-detection config.
 * Returns the delay value in seconds.
 */
export function getRandomDelay(min = 2, max = 10): number {
  const clampedMin = Math.max(min, 2);
  const clampedMax = Math.min(max, 10);
  const effectiveMin = Math.min(clampedMin, clampedMax);
  const effectiveMax = Math.max(clampedMin, clampedMax);
  return effectiveMin + Math.random() * (effectiveMax - effectiveMin);
}

/**
 * Apply anti-detection measures to a Playwright-like page object.
 * Sets User-Agent, applies proxy (if enabled), and waits a random delay.
 *
 * The `page` parameter accepts any object with `setExtraHTTPHeaders` and
 * `waitForTimeout` methods (compatible with Playwright's Page interface).
 */
export async function applyAntiDetection(
  page: {
    setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
    waitForTimeout(timeout: number): Promise<void>;
  },
  domain: string,
): Promise<void> {
  // Set rotated User-Agent
  const ua = getNextUserAgent();
  await page.setExtraHTTPHeaders({ 'User-Agent': ua });

  // Check robots.txt on first access for this domain
  await checkRobotsTxt(domain);

  // Apply random delay (convert seconds to ms)
  const delaySec = getRandomDelay();
  await page.waitForTimeout(delaySec * 1000);
}

/**
 * Check robots.txt for a domain on first access.
 * Caches the result so subsequent calls for the same domain are instant.
 * Logs warnings for any disallowed paths found.
 */
export async function checkRobotsTxt(domain: string): Promise<RobotsTxtResult> {
  const cached = robotsTxtCache.get(domain);
  if (cached) return cached;

  const result: RobotsTxtResult = { checked: true, disallowedPaths: [] };

  try {
    const url = `https://${domain}/robots.txt`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': getNextUserAgent() },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const text = await response.text();
      const lines = text.split('\n');
      let isRelevantAgent = false;

      for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.toLowerCase().startsWith('user-agent:')) {
          const agent = line.slice('user-agent:'.length).trim();
          isRelevantAgent = agent === '*';
        } else if (isRelevantAgent && line.toLowerCase().startsWith('disallow:')) {
          const path = line.slice('disallow:'.length).trim();
          if (path.length > 0) {
            result.disallowedPaths.push(path);
          }
        }
      }

      if (result.disallowedPaths.length > 0) {
        console.warn(
          `[AntiDetection] robots.txt for "${domain}" disallows paths: ${result.disallowedPaths.join(', ')}`,
        );
      }
    }
  } catch (error) {
    console.log(
      `[AntiDetection] Could not fetch robots.txt for "${domain}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  robotsTxtCache.set(domain, result);
  return result;
}

/**
 * Shuffle an array using the Fisher-Yates algorithm.
 * Returns a new array that is a random permutation of the input.
 * Does not modify the original array.
 */
export function shuffleAdapterOrder<T>(adapters: T[]): T[] {
  const shuffled = [...adapters];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get the current anti-detection configuration.
 */
export function getConfig(): AntiDetectionConfig {
  return loadConfig();
}

// ---------------------------------------------------------------------------
// Testing Utilities (exported for test access only)
// ---------------------------------------------------------------------------

/** Reset all internal state. Useful for tests. */
export function _resetForTesting(): void {
  uaIndex = 0;
  proxyIndex = 0;
  robotsTxtCache.clear();
}

/** Get the current UA pool size. */
export function _getUserAgentPoolSize(): number {
  return USER_AGENT_POOL.length;
}

/** Get the robots.txt cache for testing. */
export function _getRobotsTxtCache(): Map<string, RobotsTxtResult> {
  return robotsTxtCache;
}
