import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock playwright before importing scraperUtils
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addInitScript: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue({
          setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          $: vi.fn().mockResolvedValue(null),
          evaluate: vi.fn().mockResolvedValue(''),
        }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Mock antiDetection
vi.mock('./antiDetection', () => ({
  getNextUserAgent: vi.fn().mockReturnValue('Mozilla/5.0 TestAgent'),
  getNextProxy: vi.fn().mockReturnValue(null),
  getRandomDelay: vi.fn().mockReturnValue(3),
  applyAntiDetection: vi.fn().mockResolvedValue(undefined),
}));

import { chromium } from 'playwright';
import { getNextProxy, getRandomDelay } from './antiDetection';
import {
  closeBrowser,
  createPage,
  detectCaptcha,
  launchBrowser,
  waitWithRandomDelay,
} from './scraperUtils';

describe('scraperUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('launchBrowser', () => {
    it('launches headless Chromium with stealth args', async () => {
      const browser = await launchBrowser();
      expect(browser).toBeDefined();
      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          args: expect.arrayContaining(['--disable-blink-features=AutomationControlled']),
        }),
      );
    });

    it('includes proxy config when proxy is available', async () => {
      vi.mocked(getNextProxy).mockReturnValueOnce('http://proxy:8080');
      await launchBrowser();
      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          proxy: { server: 'http://proxy:8080' },
        }),
      );
    });

    it('omits proxy config when no proxy available', async () => {
      vi.mocked(getNextProxy).mockReturnValueOnce(null);
      await launchBrowser();
      const callArgs = vi.mocked(chromium.launch).mock.calls[0][0];
      expect(callArgs?.proxy).toBeUndefined();
    });
  });

  describe('createPage', () => {
    it('creates a page with anti-detection applied', async () => {
      const browser = await launchBrowser();
      const page = await createPage(browser, 'example.com');
      expect(page).toBeDefined();
    });
  });

  describe('closeBrowser', () => {
    it('closes the browser without throwing', async () => {
      const browser = await launchBrowser();
      await expect(closeBrowser(browser)).resolves.toBeUndefined();
    });

    it('handles close errors gracefully', async () => {
      const browser = await launchBrowser();
      vi.mocked(browser.close).mockRejectedValueOnce(new Error('close failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(closeBrowser(browser)).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('detectCaptcha', () => {
    it('returns false when no CAPTCHA elements found', async () => {
      const page = {
        $: vi.fn().mockResolvedValue(null),
        evaluate: vi.fn().mockResolvedValue('welcome to our site'),
      } as any;
      expect(await detectCaptcha(page)).toBe(false);
    });

    it('returns true when a reCAPTCHA iframe is found', async () => {
      const page = {
        $: vi
          .fn()
          .mockImplementation((selector: string) =>
            selector.includes('recaptcha') ? Promise.resolve({}) : Promise.resolve(null),
          ),
        evaluate: vi.fn().mockResolvedValue(''),
      } as any;
      expect(await detectCaptcha(page)).toBe(true);
    });

    it('returns true when body text contains CAPTCHA phrases', async () => {
      const page = {
        $: vi.fn().mockResolvedValue(null),
        evaluate: vi
          .fn()
          .mockResolvedValue('our systems have detected unusual traffic from your computer'),
      } as any;
      expect(await detectCaptcha(page)).toBe(true);
    });

    it('returns false on evaluation error', async () => {
      const page = {
        $: vi.fn().mockRejectedValue(new Error('page crashed')),
      } as any;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await detectCaptcha(page)).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('waitWithRandomDelay', () => {
    it('waits for the computed delay in milliseconds', async () => {
      vi.mocked(getRandomDelay).mockReturnValueOnce(5);
      const page = { waitForTimeout: vi.fn().mockResolvedValue(undefined) } as any;
      await waitWithRandomDelay(page, 3, 8);
      expect(page.waitForTimeout).toHaveBeenCalledWith(5000);
      expect(getRandomDelay).toHaveBeenCalledWith(3, 8);
    });
  });
});
