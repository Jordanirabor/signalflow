import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _getUserAgentPoolSize,
  _resetForTesting,
  applyAntiDetection,
  checkRobotsTxt,
  getConfig,
  getNextProxy,
  getNextUserAgent,
  getRandomDelay,
  shuffleAdapterOrder,
} from './antiDetection';

describe('AntiDetection Manager', () => {
  beforeEach(() => {
    _resetForTesting();
    delete process.env.SCRAPING_PROXY_LIST;
    delete process.env.SCRAPING_PROXY_ENABLED;
  });

  describe('getNextUserAgent', () => {
    it('returns a string from the UA pool', () => {
      const ua = getNextUserAgent();
      expect(typeof ua).toBe('string');
      expect(ua.length).toBeGreaterThan(0);
    });

    it('rotates through UAs in round-robin fashion', () => {
      const poolSize = _getUserAgentPoolSize();
      const first = getNextUserAgent();
      // Cycle through the rest
      for (let i = 1; i < poolSize; i++) {
        getNextUserAgent();
      }
      // Should wrap back to the first
      const wrapped = getNextUserAgent();
      expect(wrapped).toBe(first);
    });

    it('pool has at least 20 distinct UAs', () => {
      const poolSize = _getUserAgentPoolSize();
      expect(poolSize).toBeGreaterThanOrEqual(20);
    });
  });

  describe('getNextProxy', () => {
    it('returns null when proxy is not enabled', () => {
      expect(getNextProxy()).toBeNull();
    });

    it('returns null when proxy list is empty', () => {
      process.env.SCRAPING_PROXY_ENABLED = 'true';
      process.env.SCRAPING_PROXY_LIST = '';
      expect(getNextProxy()).toBeNull();
    });

    it('rotates through proxies when enabled', () => {
      process.env.SCRAPING_PROXY_ENABLED = 'true';
      process.env.SCRAPING_PROXY_LIST = 'http://proxy1:8080,http://proxy2:8080,http://proxy3:8080';

      const first = getNextProxy();
      const second = getNextProxy();
      const third = getNextProxy();
      const fourth = getNextProxy(); // wraps

      expect(first).toBe('http://proxy1:8080');
      expect(second).toBe('http://proxy2:8080');
      expect(third).toBe('http://proxy3:8080');
      expect(fourth).toBe('http://proxy1:8080');
    });
  });

  describe('getRandomDelay', () => {
    it('returns a value in [2, 10] with default args', () => {
      for (let i = 0; i < 50; i++) {
        const delay = getRandomDelay();
        expect(delay).toBeGreaterThanOrEqual(2);
        expect(delay).toBeLessThanOrEqual(10);
      }
    });

    it('respects custom min/max within bounds', () => {
      for (let i = 0; i < 50; i++) {
        const delay = getRandomDelay(3, 7);
        expect(delay).toBeGreaterThanOrEqual(3);
        expect(delay).toBeLessThanOrEqual(7);
      }
    });

    it('clamps min to 2 and max to 10', () => {
      for (let i = 0; i < 50; i++) {
        const delay = getRandomDelay(0, 20);
        expect(delay).toBeGreaterThanOrEqual(2);
        expect(delay).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('applyAntiDetection', () => {
    it('sets UA header and waits for delay', async () => {
      const mockPage = {
        setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      };

      // Mock fetch for robots.txt
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      try {
        await applyAntiDetection(mockPage, 'example.com');

        expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledOnce();
        const headers = mockPage.setExtraHTTPHeaders.mock.calls[0][0];
        expect(headers['User-Agent']).toBeDefined();
        expect(typeof headers['User-Agent']).toBe('string');

        expect(mockPage.waitForTimeout).toHaveBeenCalledOnce();
        const delayMs = mockPage.waitForTimeout.mock.calls[0][0];
        expect(delayMs).toBeGreaterThanOrEqual(2000);
        expect(delayMs).toBeLessThanOrEqual(10000);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('checkRobotsTxt', () => {
    it('caches results for the same domain', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nDisallow: /admin\n'),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock;

      try {
        const result1 = await checkRobotsTxt('example.com');
        const result2 = await checkRobotsTxt('example.com');

        expect(result1).toBe(result2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('parses disallowed paths from robots.txt', async () => {
      const robotsTxt = 'User-agent: *\nDisallow: /admin\nDisallow: /private\n';
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(robotsTxt),
      }) as typeof fetch;

      const result = await checkRobotsTxt('test-domain.com');
      expect(result.disallowedPaths).toContain('/admin');
      expect(result.disallowedPaths).toContain('/private');
    });

    it('handles fetch errors gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as typeof fetch;

      const result = await checkRobotsTxt('unreachable.com');
      expect(result.checked).toBe(true);
      expect(result.disallowedPaths).toEqual([]);
    });
  });

  describe('shuffleAdapterOrder', () => {
    it('returns an array with the same elements', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleAdapterOrder(input);
      expect(result).toHaveLength(input.length);
      expect(result.sort()).toEqual(input.sort());
    });

    it('does not modify the original array', () => {
      const input = [1, 2, 3, 4, 5];
      const copy = [...input];
      shuffleAdapterOrder(input);
      expect(input).toEqual(copy);
    });

    it('handles empty array', () => {
      expect(shuffleAdapterOrder([])).toEqual([]);
    });

    it('handles single element', () => {
      expect(shuffleAdapterOrder([42])).toEqual([42]);
    });
  });

  describe('getConfig', () => {
    it('returns config with defaults', () => {
      const config = getConfig();
      expect(config.userAgents.length).toBeGreaterThanOrEqual(20);
      expect(config.proxyEnabled).toBe(false);
      expect(config.proxyList).toEqual([]);
      expect(config.minDelay).toBe(2);
      expect(config.maxDelay).toBe(10);
    });

    it('reads proxy config from env', () => {
      process.env.SCRAPING_PROXY_ENABLED = 'true';
      process.env.SCRAPING_PROXY_LIST = 'http://p1:80,http://p2:80';

      const config = getConfig();
      expect(config.proxyEnabled).toBe(true);
      expect(config.proxyList).toEqual(['http://p1:80', 'http://p2:80']);
    });
  });
});
