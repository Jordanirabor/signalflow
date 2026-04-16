import type { EnrichmentData, OutreachRecord, QualityCheckResult, QualityFailure } from '@/types';

/**
 * Quality Gate Service — pure validation functions for pre-send checks.
 *
 * All functions are composable and independently testable.
 */

/**
 * Passes iff the message contains at least one enrichment element
 * (linkedinBio snippet, recentPosts reference, or companyInfo reference).
 */
export function hasPersonalization(message: string, enrichmentData?: EnrichmentData): boolean {
  if (!enrichmentData || !message) return false;

  const elements: string[] = [];

  if (enrichmentData.linkedinBio?.trim()) {
    elements.push(enrichmentData.linkedinBio.trim());
  }
  if (enrichmentData.companyInfo?.trim()) {
    elements.push(enrichmentData.companyInfo.trim());
  }
  if (enrichmentData.recentPosts) {
    for (const post of enrichmentData.recentPosts) {
      if (post.trim()) {
        elements.push(post.trim());
      }
    }
  }

  return elements.some((element) => message.includes(element));
}

/**
 * Rejects iff word count exceeds 150 (DM) or 250 (email).
 */
export function withinWordLimit(message: string, channel: 'email' | 'dm'): boolean {
  const limit = channel === 'dm' ? 150 : 250;
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  return wordCount <= limit;
}

/**
 * Passes iff leadScore >= minScore.
 */
export function meetsScoreThreshold(leadScore: number, minScore: number): boolean {
  return leadScore >= minScore;
}

/**
 * Rejects iff there is a same-channel outreach record for the same lead within 24 hours.
 */
export function noDuplicateWithin24h(
  leadId: string,
  channel: 'email' | 'dm',
  outreachRecords: OutreachRecord[],
): boolean {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return !outreachRecords.some(
    (record) =>
      record.leadId === leadId &&
      record.channel === channel &&
      new Date(record.outreachDate) >= twentyFourHoursAgo,
  );
}

/**
 * Passes iff the email has a valid format:
 * exactly one @, non-empty local part, non-empty domain, domain contains at least one dot.
 */
export function hasValidEmail(email: string): boolean {
  if (!email) return false;

  const atParts = email.split('@');
  if (atParts.length !== 2) return false;

  const [local, domain] = atParts;
  if (!local || !domain) return false;
  if (!domain.includes('.')) return false;

  // Domain must not start or end with a dot, and no consecutive dots
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;

  return true;
}

/**
 * Composes all quality checks and returns a QualityCheckResult with all failures.
 */
export function runAllChecks(params: {
  message: string;
  enrichmentData?: EnrichmentData;
  channel: 'email' | 'dm';
  leadScore: number;
  minScore: number;
  leadId: string;
  outreachRecords: OutreachRecord[];
  email: string;
}): QualityCheckResult {
  const failures: QualityFailure[] = [];

  if (!hasPersonalization(params.message, params.enrichmentData)) {
    failures.push({
      check: 'personalization',
      reason: 'Message does not contain any personalization elements from enrichment data',
    });
  }

  if (!withinWordLimit(params.message, params.channel)) {
    const limit = params.channel === 'dm' ? 150 : 250;
    failures.push({
      check: 'wordLimit',
      reason: `Message exceeds ${limit} word limit for ${params.channel} channel`,
    });
  }

  if (!meetsScoreThreshold(params.leadScore, params.minScore)) {
    failures.push({
      check: 'scoreThreshold',
      reason: `Lead score ${params.leadScore} is below minimum threshold ${params.minScore}`,
    });
  }

  if (!noDuplicateWithin24h(params.leadId, params.channel, params.outreachRecords)) {
    failures.push({
      check: 'duplicateWithin24h',
      reason: `Duplicate ${params.channel} send to lead ${params.leadId} within 24 hours`,
    });
  }

  if (!hasValidEmail(params.email)) {
    failures.push({
      check: 'validEmail',
      reason: 'Prospect does not have a valid email address',
    });
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
