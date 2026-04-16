// ============================================================
// Shared Playwright Browser Management Utilities
// ============================================================

import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';

import {
  applyAntiDetection,
  getNextProxy,
  getNextUserAgent,
  getRandomDelay,
} from './antiDetection';

// ---------------------------------------------------------------------------
// Stealth Browser Launch Flags
// ---------------------------------------------------------------------------

/**
 * Common Chromium flags to reduce detection fingerprint.
 */
const STEALTH_ARGS: string[] = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--window-size=1920,1080',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--disable-background-networking',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
];

// ---------------------------------------------------------------------------
// Browser Management
// ---------------------------------------------------------------------------

/**
 * Launch a headless Chromium browser with stealth settings to avoid detection.
 */
export async function launchBrowser(): Promise<Browser> {
  const proxy = getNextProxy();

  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: STEALTH_ARGS,
  };

  if (proxy) {
    launchOptions.proxy = { server: proxy };
  }

  const browser = await chromium.launch(launchOptions);
  return browser;
}

/**
 * Create a new page in the given browser with anti-detection measures applied.
 * Sets a rotated User-Agent, applies proxy headers if enabled, and waits a
 * random delay before returning the page.
 */
export async function createPage(browser: Browser, domain: string): Promise<Page> {
  const ua = getNextUserAgent();
  const proxy = getNextProxy();

  const contextOptions: Parameters<Browser['newContext']>[0] = {
    userAgent: ua,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
  };

  if (proxy) {
    contextOptions.proxy = { server: proxy };
  }

  const context: BrowserContext = await browser.newContext(contextOptions);

  // Remove the webdriver flag that Playwright sets by default
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();

  // Apply additional anti-detection (UA header rotation, robots.txt check, random delay)
  await applyAntiDetection(page, domain);

  return page;
}

/**
 * Safely close a browser instance. Catches and logs errors to prevent
 * unhandled rejections during cleanup.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch (error) {
    console.error(
      '[ScraperUtils] Error closing browser:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ---------------------------------------------------------------------------
// CAPTCHA Detection
// ---------------------------------------------------------------------------

/** Common CAPTCHA indicator selectors and text patterns. */
const CAPTCHA_SELECTORS = [
  // Google reCAPTCHA
  'iframe[src*="recaptcha"]',
  'iframe[src*="google.com/recaptcha"]',
  '.g-recaptcha',
  '#recaptcha',
  // hCaptcha
  'iframe[src*="hcaptcha.com"]',
  '.h-captcha',
  // Cloudflare Turnstile
  'iframe[src*="challenges.cloudflare.com"]',
  '.cf-turnstile',
  // Generic challenge indicators
  '#captcha',
  '.captcha',
  '[data-captcha]',
];

const CAPTCHA_TEXT_PATTERNS = [
  'unusual traffic',
  'are you a robot',
  'not a robot',
  'verify you are human',
  'human verification',
  'captcha',
  'please verify',
  'security check',
  'automated queries',
  'bot detection',
];

/**
 * Check if the current page shows a CAPTCHA challenge.
 * Inspects the DOM for known CAPTCHA selectors and scans visible text
 * for common CAPTCHA-related phrases.
 *
 * Returns `true` if a CAPTCHA is detected, `false` otherwise.
 */
export async function detectCaptcha(page: Page): Promise<boolean> {
  try {
    // Check for known CAPTCHA element selectors
    for (const selector of CAPTCHA_SELECTORS) {
      const element = await page.$(selector);
      if (element) {
        console.warn(`[ScraperUtils] CAPTCHA detected via selector: ${selector}`);
        return true;
      }
    }

    // Check page body text for CAPTCHA-related phrases
    const bodyText = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? '');
    for (const pattern of CAPTCHA_TEXT_PATTERNS) {
      if (bodyText.includes(pattern)) {
        console.warn(`[ScraperUtils] CAPTCHA detected via text pattern: "${pattern}"`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error(
      '[ScraperUtils] Error during CAPTCHA detection:',
      error instanceof Error ? error.message : String(error),
    );
    // If we can't check, assume no CAPTCHA to avoid false positives
    return false;
  }
}

// ---------------------------------------------------------------------------
// Random Delay Helper
// ---------------------------------------------------------------------------

/**
 * Wait a random delay on the given page. Uses the anti-detection manager's
 * `getRandomDelay` to compute the duration.
 *
 * @param page  Playwright page to wait on
 * @param min   Minimum delay in seconds (default: 2)
 * @param max   Maximum delay in seconds (default: 10)
 */
export async function waitWithRandomDelay(page: Page, min?: number, max?: number): Promise<void> {
  const delaySec = getRandomDelay(min, max);
  await page.waitForTimeout(delaySec * 1000);
}
