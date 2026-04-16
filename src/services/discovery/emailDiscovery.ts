// ============================================================
// Email Discovery Engine — Proprietary email discovery flow
// ============================================================

import dns from 'dns';
import { promisify } from 'util';

import type { EmailCandidate, EmailDiscoveryResult, ProspectContext, RunCache } from './types';

const resolveMx = promisify(dns.resolveMx);

// ---------------------------------------------------------------------------
// Domain Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the primary company domain from prospect context.
 * Checks companyDomain first, then tries to derive from linkedinUrl,
 * or falls back to a web-search-style heuristic from the company name.
 */
export async function extractCompanyDomain(prospect: ProspectContext): Promise<string | null> {
  // 1. Already have a domain
  if (prospect.companyDomain) {
    return normalizeDomain(prospect.companyDomain);
  }

  // 2. Try to extract from LinkedIn URL (e.g., linkedin.com/company/acme → acme.com)
  if (prospect.linkedinUrl) {
    const companyMatch = prospect.linkedinUrl.match(/linkedin\.com\/company\/([^/?#]+)/i);
    if (companyMatch) {
      return `${companyMatch[1].toLowerCase()}.com`;
    }
  }

  // 3. Derive from company name as a best-effort heuristic
  if (prospect.company) {
    const slug = prospect.company
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
    if (slug.length > 0) {
      return `${slug}.com`;
    }
  }

  // 4. Fallback: search for the person to find their company domain
  if (process.env.SERPER_API_KEY && prospect.name) {
    try {
      const query = prospect.twitterHandle
        ? `"${prospect.name}" @${prospect.twitterHandle} company`
        : `"${prospect.name}" ${prospect.role ?? ''} company email`;

      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query.trim(), num: 5 }),
      });

      if (res.ok) {
        const data = await res.json();
        const results = data.organic ?? [];
        for (const result of results) {
          // Look for LinkedIn profile links to extract company
          if (result.link?.includes('linkedin.com/in/')) {
            const snippet = result.snippet ?? '';
            const atMatch = snippet.match(/\bat\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\s*[·|–—\-]|$)/);
            if (atMatch) {
              const companySlug = atMatch[1]
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '');
              if (companySlug.length > 2) {
                console.log(
                  `[EmailDiscovery] Found company "${atMatch[1].trim()}" for "${prospect.name}" via search`,
                );
                return `${companySlug}.com`;
              }
            }
          }
          // Look for company website domains in results
          const domain = result.link ? new URL(result.link).hostname.replace(/^www\./, '') : null;
          if (
            domain &&
            !domain.includes('linkedin') &&
            !domain.includes('twitter') &&
            !domain.includes('x.com') &&
            !domain.includes('github') &&
            !domain.includes('google') &&
            !domain.includes('facebook')
          ) {
            console.log(
              `[EmailDiscovery] Using domain "${domain}" for "${prospect.name}" from search result`,
            );
            return domain;
          }
        }
      }
    } catch (err) {
      console.error(
        `[EmailDiscovery] Search fallback failed for "${prospect.name}":`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// MX Record Lookup
// ---------------------------------------------------------------------------

/**
 * Performs DNS MX record lookup for a domain.
 * Returns an array of MX hostnames sorted by priority (lowest first).
 */
export async function lookupMXRecords(domain: string): Promise<string[]> {
  try {
    const records = await resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Candidate Email Generation
// ---------------------------------------------------------------------------

/**
 * Generates exactly 6 candidate email addresses from first name, last name,
 * and domain using common corporate email patterns. All parts are lowercased.
 *
 * Patterns:
 *   {first}@{domain}
 *   {first}.{last}@{domain}
 *   {f}{last}@{domain}
 *   {first}{l}@{domain}
 *   {first}_{last}@{domain}
 *   {last}@{domain}
 */
export function generateCandidateEmails(
  firstName: string,
  lastName: string,
  domain: string,
): EmailCandidate[] {
  const first = firstName.toLowerCase();
  const last = lastName.toLowerCase();
  const f = first.charAt(0);
  const l = last.charAt(0);
  const d = domain.toLowerCase();

  return [
    {
      email: `${first}@${d}`,
      pattern: '{first}',
      source: 'pattern_inference' as const,
    },
    {
      email: `${first}.${last}@${d}`,
      pattern: '{first}.{last}',
      source: 'pattern_inference' as const,
    },
    {
      email: `${f}${last}@${d}`,
      pattern: '{f}{last}',
      source: 'pattern_inference' as const,
    },
    {
      email: `${first}${l}@${d}`,
      pattern: '{first}{l}',
      source: 'pattern_inference' as const,
    },
    {
      email: `${first}_${last}@${d}`,
      pattern: '{first}_{last}',
      source: 'pattern_inference' as const,
    },
    {
      email: `${last}@${d}`,
      pattern: '{last}',
      source: 'pattern_inference' as const,
    },
  ];
}

// ---------------------------------------------------------------------------
// Email Pattern Inference
// ---------------------------------------------------------------------------

/**
 * Infers the company email naming pattern from a set of known emails
 * belonging to the same domain. Returns the detected pattern string
 * (e.g., "{first}.{last}") or null if no pattern can be determined.
 */
export function inferEmailPattern(domain: string, knownEmails: string[]): string | null {
  const d = domain.toLowerCase();
  const domainEmails = knownEmails.map((e) => e.toLowerCase()).filter((e) => e.endsWith(`@${d}`));

  if (domainEmails.length === 0) return null;

  // Count occurrences of each pattern shape
  const patternCounts: Record<string, number> = {};

  for (const email of domainEmails) {
    const local = email.split('@')[0];
    const shape = classifyLocalPart(local);
    if (shape) {
      patternCounts[shape] = (patternCounts[shape] ?? 0) + 1;
    }
  }

  // Return the most common pattern
  let bestPattern: string | null = null;
  let bestCount = 0;
  for (const [pattern, count] of Object.entries(patternCounts)) {
    if (count > bestCount) {
      bestCount = count;
      bestPattern = pattern;
    }
  }

  return bestPattern;
}

/**
 * Classifies the local part of an email into a known pattern shape.
 */
function classifyLocalPart(local: string): string | null {
  if (local.includes('.')) return '{first}.{last}';
  if (local.includes('_')) return '{first}_{last}';
  // Single word — could be {first} or {last}, hard to tell without more context
  if (/^[a-z]+$/.test(local)) return '{first}';
  // Starts with single char followed by longer string (e.g., jdoe)
  if (/^[a-z][a-z]{2,}$/.test(local)) return '{f}{last}';
  return null;
}

// ---------------------------------------------------------------------------
// Candidate Prioritization
// ---------------------------------------------------------------------------

/**
 * Prioritizes email candidates so that those matching the detected pattern
 * appear before non-matching candidates. Preserves relative order within
 * each group (stable partition).
 */
export function prioritizeCandidates(
  candidates: EmailCandidate[],
  detectedPattern: string | null,
): EmailCandidate[] {
  if (!detectedPattern) return candidates;

  const matching: EmailCandidate[] = [];
  const nonMatching: EmailCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.pattern === detectedPattern) {
      matching.push(candidate);
    } else {
      nonMatching.push(candidate);
    }
  }

  return [...matching, ...nonMatching];
}

// ---------------------------------------------------------------------------
// Main Discovery Orchestrator
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full email discovery flow for a prospect:
 * 1. Extract company domain
 * 2. Lookup MX records (cached)
 * 3. Infer email pattern from known emails (cached)
 * 4. Generate candidate emails
 * 5. Prioritize candidates by detected pattern
 * 6. Verify candidates via SMTP (delegated to smtpVerifier)
 * 7. Return the best verified email or the top candidate
 */
export async function discoverEmail(
  prospect: ProspectContext,
  cache: RunCache,
): Promise<EmailDiscoveryResult> {
  const noResult: EmailDiscoveryResult = {
    email: null,
    verified: false,
    verificationMethod: 'pattern_inference',
    confidence: 'low',
    companyDomain: null,
    isCatchAll: false,
  };

  // 1. Extract company domain
  const domain = await extractCompanyDomain(prospect);
  if (!domain) {
    return noResult;
  }
  noResult.companyDomain = domain;

  // 2. Lookup MX records (use cache)
  let mxRecords = cache.getMXRecords(domain);
  if (!mxRecords) {
    mxRecords = await lookupMXRecords(domain);
    cache.setMXRecords(domain, mxRecords);
  }

  // 3. Parse prospect name
  const nameParts = prospect.name.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.length >= 2 ? nameParts[nameParts.length - 1] : firstName;

  // 4. Infer email pattern from cache or known emails
  let detectedPattern = cache.getEmailPattern(domain);
  if (!detectedPattern) {
    // Check if company data has scraped email patterns
    const companyData = cache.getCompanyData(domain);
    if (companyData && companyData.emailPatterns.length > 0) {
      detectedPattern = inferEmailPattern(domain, companyData.emailPatterns);
      if (detectedPattern) {
        cache.setEmailPattern(domain, detectedPattern);
      }
    }
  }

  // 5. Generate candidate emails
  const candidates = generateCandidateEmails(firstName, lastName, domain);

  // 6. Prioritize candidates by detected pattern
  const prioritized = prioritizeCandidates(candidates, detectedPattern);

  // 7. Attempt SMTP verification if MX records are available
  if (mxRecords.length > 0) {
    const mxHost = mxRecords[0];

    try {
      // Dynamic import to avoid circular dependency — smtpVerifier is task 7.3
      const { verifyEmail, detectCatchAll } = await import('./smtpVerifier');

      const isCatchAll = await detectCatchAll(mxHost, domain);

      for (const candidate of prioritized) {
        try {
          const result = await verifyEmail(candidate.email, mxHost);

          if (result.valid) {
            return {
              email: candidate.email,
              verified: true,
              verificationMethod: 'smtp_rcpt_to',
              confidence: isCatchAll ? 'medium' : 'high',
              companyDomain: domain,
              isCatchAll,
            };
          }
        } catch {
          // SMTP verification failed for this candidate, try next
          continue;
        }
      }
    } catch {
      // smtpVerifier module not available or import failed — fall through
    }
  }

  // 8. No SMTP verification possible or all candidates failed —
  //    return the top prioritized candidate as unverified
  const bestCandidate = prioritized[0];
  const method = detectedPattern ? 'pattern_inference' : 'pattern_inference';

  return {
    email: bestCandidate?.email ?? null,
    verified: false,
    verificationMethod: method,
    confidence: 'low',
    companyDomain: domain,
    isCatchAll: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/]+$/, '')
    .trim();
}
