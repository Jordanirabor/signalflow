// ============================================================
// Content Fetcher Service — Fetches HTML pages and extracts readable text
// ============================================================

// cheerio is lazily imported to avoid breaking module loading before it's installed (task 10)
let cheerio: typeof import('cheerio') | null = null;

async function getCheerio() {
  if (!cheerio) {
    cheerio = await import('cheerio');
  }
  return cheerio;
}

const USER_AGENT = 'SignalFlow-Research-Bot/1.0';
const DEFAULT_MAX_LENGTH = 5000;
const MIN_TEXT_LENGTH = 100;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

// Per-domain robots.txt cache: domain -> { disallowRules, fetchedAt }
const robotsCache = new Map<
  string,
  { disallowRules: { userAgent: string; paths: string[] }[]; fetchedAt: number }
>();

const ROBOTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetches a URL and extracts readable text from the HTML.
 * Returns null if the page cannot be fetched, is not HTML,
 * has insufficient text, or is disallowed by robots.txt.
 */
export async function fetchAndExtract(url: string): Promise<string | null> {
  try {
    // Check robots.txt first
    const allowed = await isAllowedByRobots(url);
    if (!allowed) {
      return null;
    }

    const html = await fetchWithRedirectLimit(url, MAX_REDIRECTS);
    if (html === null) {
      return null;
    }

    const text = await extractReadableText(html);
    if (text.length < MIN_TEXT_LENGTH) {
      return null;
    }

    return truncateText(text, DEFAULT_MAX_LENGTH);
  } catch {
    return null;
  }
}

/**
 * Fetches a URL with a 10-second timeout and redirect limit.
 * Returns the HTML body string, or null on failure.
 */
async function fetchWithRedirectLimit(url: string, maxRedirects: number): Promise<string | null> {
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(currentUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
        redirect: 'manual',
      });

      clearTimeout(timeoutId);

      // Handle redirects manually to count hops
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return null;
        }
        currentUrl = new URL(location, currentUrl).href;
        redirectCount++;
        if (redirectCount > maxRedirects) {
          return null; // Exceeded redirect limit
        }
        continue;
      }

      if (!response.ok) {
        return null;
      }

      // Check Content-Type for HTML
      const contentType = response.headers.get('content-type') || '';
      if (!isHtmlContentType(contentType)) {
        return null;
      }

      return await response.text();
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  }

  return null; // Should not reach here, but safety fallback
}

/**
 * Checks if a Content-Type header indicates HTML content.
 */
function isHtmlContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return lower.includes('text/html') || lower.includes('application/xhtml');
}

/**
 * Extracts readable text from HTML using cheerio.
 * Strips scripts, styles, nav, footer, aside, header, and ad-related elements.
 * Reads from <article>, <main>, or <body> in priority order.
 */
export async function extractReadableText(html: string): Promise<string> {
  const ch = await getCheerio();
  const $ = ch.load(html);

  // Remove unwanted elements
  $('script, style, nav, footer, aside, header').remove();

  // Remove ad-related elements by common class/id patterns
  $(
    '[class*="ad-"], [class*="ads-"], [class*="advert"], [class*="sponsor"], ' +
      '[class*="banner"], [class*="promo"], [id*="ad-"], [id*="ads-"], ' +
      '[id*="advert"], [id*="sponsor"], [id*="banner"]',
  ).remove();

  // Try to read from article, main, or body in priority order
  let text = '';

  const article = $('article');
  if (article.length > 0) {
    text = article.text();
  } else {
    const main = $('main');
    if (main.length > 0) {
      text = main.text();
    } else {
      text = $('body').text();
    }
  }

  // Normalize whitespace: collapse multiple spaces/newlines into single spaces
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Truncates text to the specified maximum length.
 * If the input is shorter than or equal to maxLength, returns it unchanged.
 */
export function truncateText(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
}

/**
 * Checks if a URL is allowed by the site's robots.txt.
 * Caches results per domain. On fetch failure, assumes allowed (permissive default).
 * Checks directives for both `*` and `SignalFlow-Research-Bot` user agents.
 */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const domain = parsed.origin;
    const path = parsed.pathname;

    // Check cache
    const cached = robotsCache.get(domain);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
      return !isDisallowed(cached.disallowRules, path);
    }

    // Fetch robots.txt
    const disallowRules = await fetchRobotsTxt(domain);
    robotsCache.set(domain, { disallowRules, fetchedAt: Date.now() });

    return !isDisallowed(disallowRules, path);
  } catch {
    // On any error, assume allowed
    return true;
  }
}

/**
 * Fetches and parses robots.txt for a domain.
 * Returns an array of { userAgent, paths } disallow rules.
 * On failure, returns empty array (permissive default).
 */
async function fetchRobotsTxt(domain: string): Promise<{ userAgent: string; paths: string[] }[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(`${domain}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return []; // Permissive default on failure
    }

    const text = await response.text();
    return parseRobotsTxt(text);
  } catch {
    return []; // Permissive default on failure
  }
}

/**
 * Parses robots.txt content into structured disallow rules.
 */
export function parseRobotsTxt(content: string): { userAgent: string; paths: string[] }[] {
  const rules: { userAgent: string; paths: string[] }[] = [];
  let currentUserAgent: string | null = null;
  let currentPaths: string[] = [];

  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comments and empty lines
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const directive = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (directive === 'user-agent') {
      // Save previous group if exists
      if (currentUserAgent !== null && currentPaths.length > 0) {
        rules.push({ userAgent: currentUserAgent, paths: [...currentPaths] });
      }
      currentUserAgent = value;
      currentPaths = [];
    } else if (directive === 'disallow' && currentUserAgent !== null && value) {
      currentPaths.push(value);
    }
  }

  // Save last group
  if (currentUserAgent !== null && currentPaths.length > 0) {
    rules.push({ userAgent: currentUserAgent, paths: [...currentPaths] });
  }

  return rules;
}

/**
 * Checks if a path is disallowed by the given robots.txt rules.
 * Checks rules for both `*` (wildcard) and `SignalFlow-Research-Bot` user agents.
 */
function isDisallowed(rules: { userAgent: string; paths: string[] }[], path: string): boolean {
  const relevantAgents = ['*', 'SignalFlow-Research-Bot'];

  for (const rule of rules) {
    if (relevantAgents.some((agent) => rule.userAgent.toLowerCase() === agent.toLowerCase())) {
      for (const disallowedPath of rule.paths) {
        if (path.startsWith(disallowedPath)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Clears the robots.txt cache. Useful for testing.
 */
export function clearRobotsCache(): void {
  robotsCache.clear();
}
