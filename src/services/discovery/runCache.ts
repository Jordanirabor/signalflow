// ============================================================
// Pipeline Run Cache — In-memory company-level cache per run
// ============================================================

import type { CachedCompanyData, RunCache } from './types';

/**
 * Normalizes a company domain for consistent cache key lookup.
 * Lowercases and strips trailing dots / slashes.
 */
function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/[./]+$/, '')
    .trim();
}

/**
 * In-memory Map-based cache created at pipeline run start and cleared at end.
 * Keyed by normalized company domain to avoid redundant scraping when
 * multiple prospects share the same company.
 */
class PipelineRunCache implements RunCache {
  private companyDataMap = new Map<string, CachedCompanyData>();
  private mxRecordsMap = new Map<string, string[]>();
  private emailPatternMap = new Map<string, string>();

  getCompanyData(domain: string): CachedCompanyData | null {
    return this.companyDataMap.get(normalizeDomain(domain)) ?? null;
  }

  setCompanyData(domain: string, data: CachedCompanyData): void {
    this.companyDataMap.set(normalizeDomain(domain), data);
  }

  getMXRecords(domain: string): string[] | null {
    return this.mxRecordsMap.get(normalizeDomain(domain)) ?? null;
  }

  setMXRecords(domain: string, records: string[]): void {
    this.mxRecordsMap.set(normalizeDomain(domain), records);
  }

  getEmailPattern(domain: string): string | null {
    return this.emailPatternMap.get(normalizeDomain(domain)) ?? null;
  }

  setEmailPattern(domain: string, pattern: string): void {
    this.emailPatternMap.set(normalizeDomain(domain), pattern);
  }

  clear(): void {
    this.companyDataMap.clear();
    this.mxRecordsMap.clear();
    this.emailPatternMap.clear();
  }
}

/** Factory — creates a fresh RunCache instance for a pipeline run. */
export function createRunCache(): RunCache {
  return new PipelineRunCache();
}
