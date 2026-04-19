// ============================================================
// Waterfall Email Finder — Multi-method email discovery
// ============================================================

import dns from 'dns';
import { promisify } from 'util';

import { logStructured } from './discoveryLogger';
import type { ProspectContext, RunCache, WaterfallEmailResult, WaterfallStep } from './types';

const resolveMx = promisify(dns.resolveMx);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Social media domains to exclude from domain discovery */
const SOCIAL_MEDIA_DOMAINS = [
  'linkedin.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'github.com',
  'instagram.com',
];

/** Domains that should never be used as a prospect's company email domain */
const BLOCKED_EMAIL_DOMAINS = [
  'ca.gov',
  'gov',
  'state.gov',
  'nih.gov',
  'nimhd.nih.gov',
  'google.com',
  'play.google.com',
  'podcasts.com',
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'wikipedia.org',
  'youtube.com',
  'reddit.com',
  'medium.com',
  'substack.com',
  'wordpress.com',
  'blogspot.com',
  'amazon.com',
  'apple.com',
];

/** Module-level cache for company name → discovered domain (per-import lifetime) */
const companyDomainCache = new Map<string, string | null>();

// ---------------------------------------------------------------------------
// Domain Discovery
// ---------------------------------------------------------------------------

/**
 * Normalize a domain string: lowercase, strip protocol/www/trailing slashes.
 */
function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/]+$/, '')
    .trim();
}

/**
 * Check if a domain belongs to a social media site.
 */
function isSocialMediaDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return SOCIAL_MEDIA_DOMAINS.some(
    (social) => normalized === social || normalized.endsWith(`.${social}`),
  );
}

/**
 * Check if a domain should never be used as a prospect's company email domain.
 * Blocks government sites, generic email providers, and large platforms.
 */
function isBlockedEmailDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return BLOCKED_EMAIL_DOMAINS.some(
    (blocked) => normalized === blocked || normalized.endsWith(`.${blocked}`),
  );
}

/**
 * Check if a company name looks like a real company (not a job title, generic term, etc.).
 * Returns false for values that are clearly not company names.
 */
function isValidCompanyName(company: string): boolean {
  if (!company || company.trim().length < 2) return false;
  const lower = company.toLowerCase().trim();
  // Reject common job titles mistakenly stored as company names
  const jobTitlePatterns =
    /^(software engineer|product manager|data scientist|cto|ceo|cmo|cfo|coo|vp|director|head of|chief|engineer|developer|designer|analyst|consultant|freelancer|self[- ]employed|unemployed|student|intern|not specified)$/i;
  if (jobTitlePatterns.test(lower)) return false;
  // Reject single generic words
  if (
    lower.split(/\s+/).length === 1 &&
    ['technology', 'finance', 'healthcare', 'saas', 'it', 'ai', 'ml'].includes(lower)
  )
    return false;
  return true;
}

/**
 * Validate that a domain has MX records via DNS lookup.
 */
async function hasMXRecords(domain: string, cache: RunCache): Promise<boolean> {
  // Check cache first
  const cached = cache.getMXRecords(domain);
  if (cached !== null) {
    return cached.length > 0;
  }

  try {
    const records = await resolveMx(domain);
    const sorted = records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
    cache.setMXRecords(domain, sorted);
    return sorted.length > 0;
  } catch {
    cache.setMXRecords(domain, []);
    return false;
  }
}

/**
 * Search for company domain via Serper web search.
 * Validates domain has MX records before returning.
 * Caches verified domain in RunCache.
 *
 * Falls back to LinkedIn URL extraction → companyname.com heuristic.
 */
export async function discoverCompanyDomain(
  companyName: string,
  cache: RunCache,
): Promise<string | null> {
  const cacheKey = companyName.toLowerCase().trim();

  // Reject invalid company names early
  if (!isValidCompanyName(companyName)) {
    companyDomainCache.set(cacheKey, null);
    return null;
  }

  // Check module-level cache
  if (companyDomainCache.has(cacheKey)) {
    return companyDomainCache.get(cacheKey) ?? null;
  }

  let domain: string | null = null;

  // Step 1: Serper web search for official website
  if (process.env.SERPER_API_KEY) {
    try {
      domain = await searchDomainViaSerper(companyName);
      if (domain) {
        const hasMx = await hasMXRecords(domain, cache);
        if (hasMx) {
          companyDomainCache.set(cacheKey, domain);
          return domain;
        }
        // Domain found but no MX records — continue to fallbacks
        domain = null;
      }
    } catch (err) {
      console.error(
        `[WaterfallEmailFinder] Serper domain search failed for "${companyName}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Step 2: Fallback — LinkedIn URL extraction (companyname.com heuristic)
  if (!domain) {
    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
    if (slug.length > 0) {
      const heuristicDomain = `${slug}.com`;
      const hasMx = await hasMXRecords(heuristicDomain, cache);
      if (hasMx) {
        domain = heuristicDomain;
      }
    }
  }

  companyDomainCache.set(cacheKey, domain);
  return domain;
}

/**
 * Search Serper for a company's official website domain.
 * Excludes social media domains from results.
 */
async function searchDomainViaSerper(companyName: string): Promise<string | null> {
  const query = `"${companyName}" official website`;

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 10 }),
  });

  if (!res.ok) {
    console.warn(`[WaterfallEmailFinder] Serper search failed: ${res.status} ${res.statusText}`);
    return null;
  }

  const data = await res.json();
  const results = data.organic ?? [];

  for (const result of results) {
    if (!result.link) continue;

    try {
      const url = new URL(result.link);
      const domain = normalizeDomain(url.hostname);

      if (!isSocialMediaDomain(domain) && !isBlockedEmailDomain(domain)) {
        return domain;
      }
    } catch {
      // Invalid URL, skip
      continue;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Waterfall Steps
// ---------------------------------------------------------------------------

/**
 * Step 1: Web search for email patterns on company website.
 * Searches for contact pages, team pages, and press releases.
 */
async function stepWebSearch(
  prospect: ProspectContext,
  domain: string,
): Promise<{ email: string | null; verified: boolean }> {
  if (!process.env.SERPER_API_KEY) {
    return { email: null, verified: false };
  }

  const queries = [
    `"${prospect.name}" email "${domain}"`,
    `"${prospect.name}" contact "${prospect.company}"`,
    `site:${domain} "${prospect.name}" email`,
  ];

  for (const query of queries) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, num: 5 }),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const results = data.organic ?? [];

      for (const result of results) {
        const text = `${result.title ?? ''} ${result.snippet ?? ''}`;
        const emailMatch = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
        if (emailMatch) {
          const foundEmail = emailMatch[1].toLowerCase();
          // Verify the email domain matches the company domain
          const emailDomain = foundEmail.split('@')[1];
          if (emailDomain === domain || emailDomain === `www.${domain}`) {
            return { email: foundEmail, verified: false };
          }
        }
      }
    } catch {
      // Search failed, try next query
      continue;
    }
  }

  return { email: null, verified: false };
}

/**
 * Step 2: Pattern inference from known company emails.
 * Generates candidate emails using common patterns.
 * Skipped for single-word names.
 */
function stepPatternInference(
  prospect: ProspectContext,
  domain: string,
  cache: RunCache,
): { email: string | null; pattern: string | null } {
  const nameParts = prospect.name.trim().split(/\s+/);
  if (nameParts.length < 2) {
    // Single-word name — skip pattern inference
    return { email: null, pattern: null };
  }

  const firstName = nameParts[0].toLowerCase();
  const lastName = nameParts[nameParts.length - 1].toLowerCase();
  const f = firstName.charAt(0);
  const l = lastName.charAt(0);
  const d = domain.toLowerCase();

  // Check if we have a known pattern for this domain
  let detectedPattern = cache.getEmailPattern(domain);
  if (!detectedPattern) {
    const companyData = cache.getCompanyData(domain);
    if (companyData && companyData.emailPatterns.length > 0) {
      detectedPattern = inferPatternFromEmails(companyData.emailPatterns, domain);
      if (detectedPattern) {
        cache.setEmailPattern(domain, detectedPattern);
      }
    }
  }

  // Generate candidates in priority order
  const candidates = [
    { email: `${firstName}.${lastName}@${d}`, pattern: '{first}.{last}' },
    { email: `${firstName}@${d}`, pattern: '{first}' },
    { email: `${f}${lastName}@${d}`, pattern: '{f}{last}' },
    { email: `${firstName}${l}@${d}`, pattern: '{first}{l}' },
    { email: `${firstName}_${lastName}@${d}`, pattern: '{first}_{last}' },
    { email: `${lastName}@${d}`, pattern: '{last}' },
  ];

  // If we have a detected pattern, prioritize matching candidates
  if (detectedPattern) {
    const match = candidates.find((c) => c.pattern === detectedPattern);
    if (match) {
      return { email: match.email, pattern: match.pattern };
    }
  }

  // Return the most common pattern as best guess
  return { email: candidates[0].email, pattern: candidates[0].pattern };
}

/**
 * Infer email pattern from a set of known emails for a domain.
 */
function inferPatternFromEmails(emails: string[], domain: string): string | null {
  const d = domain.toLowerCase();
  const domainEmails = emails.map((e) => e.toLowerCase()).filter((e) => e.endsWith(`@${d}`));

  if (domainEmails.length === 0) return null;

  const patternCounts: Record<string, number> = {};
  for (const email of domainEmails) {
    const local = email.split('@')[0];
    if (local.includes('.'))
      patternCounts['{first}.{last}'] = (patternCounts['{first}.{last}'] ?? 0) + 1;
    else if (local.includes('_'))
      patternCounts['{first}_{last}'] = (patternCounts['{first}_{last}'] ?? 0) + 1;
    else patternCounts['{first}'] = (patternCounts['{first}'] ?? 0) + 1;
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [pattern, count] of Object.entries(patternCounts)) {
    if (count > bestCount) {
      bestCount = count;
      best = pattern;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Apollo Name Resolution
// ---------------------------------------------------------------------------

/**
 * Check if a name contains obfuscated characters (asterisks).
 * Apollo's free plan returns names like "Sm***h" instead of "Smith".
 */
export function isObfuscatedName(name: string): boolean {
  return name.includes('*');
}

/**
 * Resolve an obfuscated Apollo name by cross-referencing with LinkedIn results.
 *
 * When Apollo returns names like "John Sm***h", this function attempts to find
 * a matching full name from LinkedIn-sourced prospects by comparing:
 * - First name exact match
 * - Last name pattern match (obfuscated chars treated as wildcards)
 * - Same company
 *
 * @param obfuscatedName - The obfuscated name from Apollo (e.g. "John Sm***h")
 * @param company - The company name for the prospect
 * @param linkedInProspects - Array of prospects discovered via LinkedIn/proprietary sources
 * @returns The resolved full name, or the original obfuscated name if no match found
 */
export function resolveObfuscatedName(
  obfuscatedName: string,
  company: string,
  linkedInProspects: Array<{ name: string; company: string }>,
): string {
  if (!isObfuscatedName(obfuscatedName)) {
    return obfuscatedName;
  }

  const parts = obfuscatedName.trim().split(/\s+/);
  if (parts.length < 2) return obfuscatedName;

  const obfuscatedFirst = parts[0].toLowerCase();
  const obfuscatedLast = parts[parts.length - 1].toLowerCase();
  const normalizedCompany = company.toLowerCase().trim().replace(/\s+/g, ' ');

  // Build a regex from the obfuscated last name: "Sm***h" → /^sm.+h$/i
  // Asterisks replace an unknown number of characters, so use .+ for any group
  const lastNamePattern = obfuscatedLast.replace(/\*+/g, '.+');
  let lastNameRegex: RegExp;
  try {
    lastNameRegex = new RegExp(`^${lastNamePattern}$`, 'i');
  } catch {
    // Invalid regex from unusual obfuscation — return original
    return obfuscatedName;
  }

  for (const prospect of linkedInProspects) {
    const prospectCompany = prospect.company.toLowerCase().trim().replace(/\s+/g, ' ');
    if (prospectCompany !== normalizedCompany) continue;

    const prospectParts = prospect.name.trim().split(/\s+/);
    if (prospectParts.length < 2) continue;

    const prospectFirst = prospectParts[0].toLowerCase();
    const prospectLast = prospectParts[prospectParts.length - 1].toLowerCase();

    // Match: same first name and last name matches the obfuscated pattern
    if (prospectFirst === obfuscatedFirst && lastNameRegex.test(prospectLast)) {
      return prospect.name;
    }
  }

  return obfuscatedName;
}

// ---------------------------------------------------------------------------
// Waterfall Steps
// ---------------------------------------------------------------------------

/**
 * Step 3: Hunter API lookup.
 * Only executes when HUNTER_API_KEY is configured.
 */
async function stepHunterApi(
  prospect: ProspectContext,
  domain: string,
): Promise<{ email: string | null; verified: boolean }> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey || process.env.HUNTER_ENABLED?.toLowerCase() !== 'true') {
    return { email: null, verified: false };
  }

  const nameParts = prospect.name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.length >= 2 ? nameParts[nameParts.length - 1] : '';

  const params = new URLSearchParams({
    domain,
    first_name: firstName,
    last_name: lastName,
    api_key: apiKey,
  });

  const response = await fetch(`https://api.hunter.io/v2/email-finder?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Hunter API returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    data?: {
      email?: string;
      score?: number;
      verification?: { status?: string };
    };
  };

  if (data.data?.email) {
    return {
      email: data.data.email,
      verified: data.data.verification?.status === 'valid',
    };
  }

  return { email: null, verified: false };
}

/**
 * Step 4: Apollo API lookup.
 * Only executes when APOLLO_ENABLED=true and APOLLO_API_KEY is set.
 * Handles obfuscated names by using resolved names when available.
 */
async function stepApolloApi(
  prospect: ProspectContext,
  domain: string,
  linkedInProspects?: Array<{ name: string; company: string }>,
): Promise<{ email: string | null; verified: boolean }> {
  if (process.env.APOLLO_ENABLED?.toLowerCase() !== 'true' || !process.env.APOLLO_API_KEY) {
    return { email: null, verified: false };
  }

  const apiKey = process.env.APOLLO_API_KEY;

  // Resolve obfuscated names by cross-referencing with LinkedIn results
  const resolvedName = linkedInProspects
    ? resolveObfuscatedName(prospect.name, prospect.company, linkedInProspects)
    : prospect.name;

  const nameParts = resolvedName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.length >= 2 ? nameParts[nameParts.length - 1] : '';

  const response = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      organization_name: prospect.company,
      domain,
    }),
  });

  if (!response.ok) {
    throw new Error(`Apollo API returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    person?: {
      email?: string;
      email_status?: string;
    };
  };

  if (data.person?.email) {
    return {
      email: data.person.email,
      verified: data.person.email_status === 'verified',
    };
  }

  return { email: null, verified: false };
}

/**
 * Step 5: SMTP verification for a candidate email.
 */
async function stepSmtpVerification(
  email: string,
  domain: string,
  cache: RunCache,
): Promise<{ verified: boolean; isCatchAll: boolean }> {
  // Skip SMTP verification when disabled (port 25 is often blocked in cloud/home networks)
  if (process.env.SMTP_VERIFICATION_ENABLED?.toLowerCase() !== 'true') {
    return { verified: false, isCatchAll: false };
  }

  let mxRecords = cache.getMXRecords(domain);
  if (mxRecords === null) {
    try {
      const records = await resolveMx(domain);
      mxRecords = records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
      cache.setMXRecords(domain, mxRecords);
    } catch {
      cache.setMXRecords(domain, []);
      return { verified: false, isCatchAll: false };
    }
  }

  if (mxRecords.length === 0) {
    return { verified: false, isCatchAll: false };
  }

  const mxHost = mxRecords[0];

  try {
    const { verifyEmail, detectCatchAll } = await import('./smtpVerifier');
    const isCatchAll = await detectCatchAll(mxHost, domain);
    const result = await verifyEmail(email, mxHost);

    return {
      verified: result.valid,
      isCatchAll,
    };
  } catch {
    return { verified: false, isCatchAll: false };
  }
}

// ---------------------------------------------------------------------------
// Waterfall Orchestrator
// ---------------------------------------------------------------------------

/**
 * Execute a single waterfall step, recording timing and result.
 */
async function executeStep<T>(
  method: WaterfallStep['method'],
  fn: () => Promise<T>,
): Promise<{ step: WaterfallStep; result: T }> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration_ms = Date.now() - start;
    return {
      step: { method, result: 'not_found', duration_ms },
      result,
    };
  } catch (err) {
    const duration_ms = Date.now() - start;
    return {
      step: {
        method,
        result: 'error',
        duration_ms,
        error: err instanceof Error ? err.message : String(err),
      },
      result: undefined as unknown as T,
    };
  }
}

/**
 * Discover email using waterfall approach:
 * 1. Web search for email patterns on company website
 * 2. Pattern inference from known company emails
 * 3. Hunter API lookup (if configured)
 * 4. Apollo API lookup (if configured)
 * 5. SMTP verification as validation
 *
 * Short-circuits on first verified email found.
 */
export async function waterfallEmailDiscover(
  prospect: ProspectContext,
  cache: RunCache,
  linkedInProspects?: Array<{ name: string; company: string }>,
): Promise<WaterfallEmailResult> {
  const stepsAttempted: WaterfallStep[] = [];
  let bestCandidate: {
    email: string;
    method: string;
    confidence: 'high' | 'medium' | 'low';
  } | null = null;

  // Resolve company domain first
  const domain = prospect.companyDomain
    ? normalizeDomain(prospect.companyDomain)
    : await discoverCompanyDomain(prospect.company, cache);

  const waterfallStart = Date.now();

  const noResult: WaterfallEmailResult = {
    email: null,
    verified: false,
    verificationMethod: 'pattern_inference',
    confidence: 'low',
    companyDomain: domain,
    isCatchAll: false,
    stepsAttempted,
    finalMethod: null,
  };

  if (!domain) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'warn',
      message: 'Waterfall completed: no domain resolved',
      metadata: {
        prospect: prospect.name,
        company: prospect.company,
        result: 'no_domain',
        duration_ms: Date.now() - waterfallStart,
      },
    });
    return noResult;
  }

  // --- Step 1: Web Search ---
  logStructured({
    timestamp: new Date().toISOString(),
    stage: 'email_discovery',
    level: 'info',
    message: 'Waterfall step starting: web_search',
    metadata: { method: 'web_search', prospect: prospect.name, domain },
  });
  const webSearchResult = await executeStep('web_search', () => stepWebSearch(prospect, domain));

  if (webSearchResult.step.result === 'error') {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'error',
      message: 'Waterfall step completed: web_search — error',
      metadata: {
        method: 'web_search',
        result: 'error',
        error: webSearchResult.step.error,
        duration_ms: webSearchResult.step.duration_ms,
      },
    });
    stepsAttempted.push(webSearchResult.step);
  } else if (webSearchResult.result?.email) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step completed: web_search — found',
      metadata: {
        method: 'web_search',
        result: 'found',
        email: webSearchResult.result.email,
        duration_ms: webSearchResult.step.duration_ms,
      },
    });
    webSearchResult.step.result = 'found';
    webSearchResult.step.email = webSearchResult.result.email;
    stepsAttempted.push(webSearchResult.step);

    // Try SMTP verification on the found email
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step starting: smtp_verification (for web_search candidate)',
      metadata: { method: 'smtp_verification', email: webSearchResult.result.email, domain },
    });
    const smtpResult = await executeStep('smtp_verification', () =>
      stepSmtpVerification(webSearchResult.result.email!, domain, cache),
    );
    smtpResult.step.email = webSearchResult.result.email;

    if (smtpResult.result?.verified) {
      smtpResult.step.result = 'found';
      smtpResult.step.verified = true;
      stepsAttempted.push(smtpResult.step);
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'email_discovery',
        level: 'info',
        message: 'Waterfall completed: verified email found via web_search',
        metadata: {
          finalMethod: 'web_search',
          email: webSearchResult.result.email,
          verified: true,
          duration_ms: Date.now() - waterfallStart,
        },
      });
      return {
        email: webSearchResult.result.email,
        verified: true,
        verificationMethod: 'smtp_rcpt_to',
        confidence: smtpResult.result.isCatchAll ? 'medium' : 'high',
        companyDomain: domain,
        isCatchAll: smtpResult.result.isCatchAll,
        stepsAttempted,
        finalMethod: 'web_search',
      };
    }

    // Not verified via SMTP but still a candidate
    bestCandidate = {
      email: webSearchResult.result.email,
      method: 'web_search',
      confidence: 'medium',
    };
  } else {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step completed: web_search — not_found',
      metadata: {
        method: 'web_search',
        result: 'not_found',
        duration_ms: webSearchResult.step.duration_ms,
      },
    });
    webSearchResult.step.result = 'not_found';
    stepsAttempted.push(webSearchResult.step);
  }

  // --- Step 2: Pattern Inference (skip for single-word names) ---
  const isSingleWordName = prospect.name.trim().split(/\s+/).length < 2;

  if (!isSingleWordName) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step starting: pattern_inference',
      metadata: { method: 'pattern_inference', prospect: prospect.name, domain },
    });
    const patternStart = Date.now();
    const patternResult = stepPatternInference(prospect, domain, cache);
    const patternDuration = Date.now() - patternStart;

    const patternStep: WaterfallStep = {
      method: 'pattern_inference',
      result: patternResult.email ? 'found' : 'not_found',
      email: patternResult.email ?? undefined,
      duration_ms: patternDuration,
    };

    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: `Waterfall step completed: pattern_inference — ${patternResult.email ? 'found' : 'not_found'}`,
      metadata: {
        method: 'pattern_inference',
        result: patternResult.email ? 'found' : 'not_found',
        email: patternResult.email ?? undefined,
        duration_ms: patternDuration,
      },
    });

    if (patternResult.email) {
      // Try SMTP verification on the pattern-inferred email
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'email_discovery',
        level: 'info',
        message: 'Waterfall step starting: smtp_verification (for pattern_inference candidate)',
        metadata: { method: 'smtp_verification', email: patternResult.email, domain },
      });
      const smtpResult = await executeStep('smtp_verification', () =>
        stepSmtpVerification(patternResult.email!, domain, cache),
      );
      smtpResult.step.email = patternResult.email;

      if (smtpResult.result?.verified) {
        smtpResult.step.result = 'found';
        smtpResult.step.verified = true;
        stepsAttempted.push(patternStep);
        stepsAttempted.push(smtpResult.step);
        logStructured({
          timestamp: new Date().toISOString(),
          stage: 'email_discovery',
          level: 'info',
          message: 'Waterfall completed: verified email found via pattern_inference',
          metadata: {
            finalMethod: 'pattern_inference',
            email: patternResult.email,
            verified: true,
            duration_ms: Date.now() - waterfallStart,
          },
        });
        return {
          email: patternResult.email,
          verified: true,
          verificationMethod: 'smtp_rcpt_to',
          confidence: smtpResult.result.isCatchAll ? 'medium' : 'high',
          companyDomain: domain,
          isCatchAll: smtpResult.result.isCatchAll,
          stepsAttempted,
          finalMethod: 'pattern_inference',
        };
      }

      // Not verified but better than nothing
      if (!bestCandidate) {
        bestCandidate = {
          email: patternResult.email,
          method: 'pattern_inference',
          confidence: 'low',
        };
      }
    }

    stepsAttempted.push(patternStep);
  }

  // --- Step 3: Hunter API ---
  logStructured({
    timestamp: new Date().toISOString(),
    stage: 'email_discovery',
    level: 'info',
    message: 'Waterfall step starting: hunter_api',
    metadata: { method: 'hunter_api', prospect: prospect.name, domain },
  });
  const hunterResult = await executeStep('hunter_api', () => stepHunterApi(prospect, domain));

  if (hunterResult.step.result === 'error') {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'error',
      message: 'Waterfall step completed: hunter_api — error',
      metadata: {
        method: 'hunter_api',
        result: 'error',
        error: hunterResult.step.error,
        duration_ms: hunterResult.step.duration_ms,
      },
    });
    stepsAttempted.push(hunterResult.step);
  } else if (hunterResult.result?.email) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step completed: hunter_api — found',
      metadata: {
        method: 'hunter_api',
        result: 'found',
        email: hunterResult.result.email,
        verified: hunterResult.result.verified,
        duration_ms: hunterResult.step.duration_ms,
      },
    });
    hunterResult.step.result = 'found';
    hunterResult.step.email = hunterResult.result.email;
    hunterResult.step.verified = hunterResult.result.verified;
    stepsAttempted.push(hunterResult.step);

    if (hunterResult.result.verified) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'email_discovery',
        level: 'info',
        message: 'Waterfall completed: verified email found via hunter_api',
        metadata: {
          finalMethod: 'hunter_api',
          email: hunterResult.result.email,
          verified: true,
          duration_ms: Date.now() - waterfallStart,
        },
      });
      return {
        email: hunterResult.result.email,
        verified: true,
        verificationMethod: 'hunter_api',
        confidence: 'high',
        companyDomain: domain,
        isCatchAll: false,
        stepsAttempted,
        finalMethod: 'hunter_api',
      };
    }

    // Hunter found email but not verified — try SMTP
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step starting: smtp_verification (for hunter_api candidate)',
      metadata: { method: 'smtp_verification', email: hunterResult.result.email, domain },
    });
    const smtpResult = await executeStep('smtp_verification', () =>
      stepSmtpVerification(hunterResult.result.email!, domain, cache),
    );
    smtpResult.step.email = hunterResult.result.email;

    if (smtpResult.result?.verified) {
      smtpResult.step.result = 'found';
      smtpResult.step.verified = true;
      stepsAttempted.push(smtpResult.step);
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'email_discovery',
        level: 'info',
        message: 'Waterfall completed: verified email found via hunter_api + smtp',
        metadata: {
          finalMethod: 'hunter_api',
          email: hunterResult.result.email,
          verified: true,
          duration_ms: Date.now() - waterfallStart,
        },
      });
      return {
        email: hunterResult.result.email,
        verified: true,
        verificationMethod: 'smtp_rcpt_to',
        confidence: smtpResult.result.isCatchAll ? 'medium' : 'high',
        companyDomain: domain,
        isCatchAll: smtpResult.result.isCatchAll,
        stepsAttempted,
        finalMethod: 'hunter_api',
      };
    }

    if (!bestCandidate || bestCandidate.confidence === 'low') {
      bestCandidate = {
        email: hunterResult.result.email,
        method: 'hunter_api',
        confidence: 'medium',
      };
    }
  } else {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step completed: hunter_api — not_found',
      metadata: {
        method: 'hunter_api',
        result: 'not_found',
        duration_ms: hunterResult.step.duration_ms,
      },
    });
    hunterResult.step.result = 'not_found';
    stepsAttempted.push(hunterResult.step);
  }

  // --- Step 4: Apollo API (if enabled) ---
  logStructured({
    timestamp: new Date().toISOString(),
    stage: 'email_discovery',
    level: 'info',
    message: 'Waterfall step starting: apollo_api',
    metadata: { method: 'apollo_api', prospect: prospect.name, domain },
  });
  const apolloResult = await executeStep('apollo_api', () =>
    stepApolloApi(prospect, domain, linkedInProspects),
  );

  if (apolloResult.step.result === 'error') {
    // Only record Apollo step if it was actually enabled
    if (process.env.APOLLO_ENABLED?.toLowerCase() === 'true' && process.env.APOLLO_API_KEY) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'email_discovery',
        level: 'error',
        message: 'Waterfall step completed: apollo_api — error',
        metadata: {
          method: 'apollo_api',
          result: 'error',
          error: apolloResult.step.error,
          duration_ms: apolloResult.step.duration_ms,
        },
      });
      stepsAttempted.push(apolloResult.step);
    }
  } else if (apolloResult.result?.email) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step completed: apollo_api — found',
      metadata: {
        method: 'apollo_api',
        result: 'found',
        email: apolloResult.result.email,
        verified: apolloResult.result.verified,
        duration_ms: apolloResult.step.duration_ms,
      },
    });
    apolloResult.step.result = 'found';
    apolloResult.step.email = apolloResult.result.email;
    apolloResult.step.verified = apolloResult.result.verified;
    stepsAttempted.push(apolloResult.step);

    if (apolloResult.result.verified) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'email_discovery',
        level: 'info',
        message: 'Waterfall completed: verified email found via apollo_api',
        metadata: {
          finalMethod: 'apollo_api',
          email: apolloResult.result.email,
          verified: true,
          duration_ms: Date.now() - waterfallStart,
        },
      });
      return {
        email: apolloResult.result.email,
        verified: true,
        verificationMethod: 'hunter_api', // Apollo uses hunter-style verification
        confidence: 'high',
        companyDomain: domain,
        isCatchAll: false,
        stepsAttempted,
        finalMethod: 'apollo_api',
      };
    }

    // Apollo found email but not verified — try SMTP
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step starting: smtp_verification (for apollo_api candidate)',
      metadata: { method: 'smtp_verification', email: apolloResult.result.email, domain },
    });
    const smtpResult = await executeStep('smtp_verification', () =>
      stepSmtpVerification(apolloResult.result.email!, domain, cache),
    );
    smtpResult.step.email = apolloResult.result.email;

    if (smtpResult.result?.verified) {
      smtpResult.step.result = 'found';
      smtpResult.step.verified = true;
      stepsAttempted.push(smtpResult.step);
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'email_discovery',
        level: 'info',
        message: 'Waterfall completed: verified email found via apollo_api + smtp',
        metadata: {
          finalMethod: 'apollo_api',
          email: apolloResult.result.email,
          verified: true,
          duration_ms: Date.now() - waterfallStart,
        },
      });
      return {
        email: apolloResult.result.email,
        verified: true,
        verificationMethod: 'smtp_rcpt_to',
        confidence: smtpResult.result.isCatchAll ? 'medium' : 'high',
        companyDomain: domain,
        isCatchAll: smtpResult.result.isCatchAll,
        stepsAttempted,
        finalMethod: 'apollo_api',
      };
    }

    if (!bestCandidate || bestCandidate.confidence === 'low') {
      bestCandidate = {
        email: apolloResult.result.email,
        method: 'apollo_api',
        confidence: 'medium',
      };
    }
  } else if (process.env.APOLLO_ENABLED?.toLowerCase() === 'true' && process.env.APOLLO_API_KEY) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step completed: apollo_api — not_found',
      metadata: {
        method: 'apollo_api',
        result: 'not_found',
        duration_ms: apolloResult.step.duration_ms,
      },
    });
    apolloResult.step.result = 'not_found';
    stepsAttempted.push(apolloResult.step);
  }

  // --- Step 5: Final SMTP verification on best candidate ---
  if (
    bestCandidate &&
    !stepsAttempted.some((s) => s.method === 'smtp_verification' && s.verified)
  ) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'info',
      message: 'Waterfall step starting: smtp_verification (final validation)',
      metadata: { method: 'smtp_verification', email: bestCandidate.email, domain },
    });
    const smtpResult = await executeStep('smtp_verification', () =>
      stepSmtpVerification(bestCandidate!.email, domain, cache),
    );
    smtpResult.step.email = bestCandidate.email;

    if (smtpResult.result?.verified) {
      smtpResult.step.result = 'found';
      smtpResult.step.verified = true;
      stepsAttempted.push(smtpResult.step);
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'email_discovery',
        level: 'info',
        message: `Waterfall completed: verified email found via ${bestCandidate.method} + smtp`,
        metadata: {
          finalMethod: bestCandidate.method,
          email: bestCandidate.email,
          verified: true,
          duration_ms: Date.now() - waterfallStart,
        },
      });
      return {
        email: bestCandidate.email,
        verified: true,
        verificationMethod: 'smtp_rcpt_to',
        confidence: smtpResult.result.isCatchAll ? 'medium' : 'high',
        companyDomain: domain,
        isCatchAll: smtpResult.result.isCatchAll,
        stepsAttempted,
        finalMethod: bestCandidate.method,
      };
    }

    smtpResult.step.result = 'not_found';
    stepsAttempted.push(smtpResult.step);
  }

  // --- All steps failed: return best unverified candidate ---
  if (bestCandidate) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'email_discovery',
      level: 'warn',
      message: 'Waterfall completed: returning unverified candidate',
      metadata: {
        finalMethod: bestCandidate.method,
        email: bestCandidate.email,
        verified: false,
        confidence: 'low',
        duration_ms: Date.now() - waterfallStart,
      },
    });
    return {
      email: bestCandidate.email,
      verified: false,
      verificationMethod: 'pattern_inference',
      confidence: 'low',
      companyDomain: domain,
      isCatchAll: false,
      stepsAttempted,
      finalMethod: bestCandidate.method,
    };
  }

  logStructured({
    timestamp: new Date().toISOString(),
    stage: 'email_discovery',
    level: 'warn',
    message: 'Waterfall completed: no email found',
    metadata: {
      finalMethod: null,
      result: 'no_email',
      stepsCount: stepsAttempted.length,
      duration_ms: Date.now() - waterfallStart,
    },
  });
  return noResult;
}

/**
 * Clear the module-level company domain cache.
 * Useful for testing.
 */
export function clearDomainCache(): void {
  companyDomainCache.clear();
}
