// ============================================================
// Lead Discovery & Enrichment Engine — Shared Types & Interfaces
// ============================================================

import type { DiscoveredLeadData } from '@/services/enrichmentService';
import type { EnrichmentData, ICP } from '@/types';

// Re-export for convenience
export type { DiscoveredLeadData, EnrichmentData, ICP };

// ---------------------------------------------------------------------------
// Extended Enrichment Data
// ---------------------------------------------------------------------------

/**
 * Extends the base EnrichmentData with all discovery-specific fields.
 * Used internally by source adapters and the enrichment pipeline.
 */
export interface ExtendedEnrichmentData extends EnrichmentData {
  email?: string;
  emailVerified?: boolean;
  emailVerificationMethod?:
    | 'smtp_rcpt_to'
    | 'hunter_api'
    | 'pattern_inference'
    | 'github_commit'
    | 'website_scrape'
    | 'press_release'
    | 'research_agent_web_search';
  linkedinUrl?: string;
  companyDomain?: string;
  dataConfidenceScore?: number;
  lastVerifiedAt?: Date;
  dataSources?: string[];
}

// ---------------------------------------------------------------------------
// Source Adapter Interface
// ---------------------------------------------------------------------------

/**
 * Common interface for all discovery and enrichment source adapters.
 * Extends the existing EnrichmentSource pattern in enrichmentService.ts.
 */
export interface SourceAdapter {
  /** Unique identifier for this source (e.g., "google_search", "linkedin_scrape") */
  name: string;
  /** Whether this adapter is used for discovery, enrichment, or both */
  capabilities: ('discovery' | 'enrichment')[];
  /** Check if this adapter is enabled via environment configuration */
  isEnabled(): boolean;
  /** Discover prospects matching the ICP (discovery-capable adapters only) */
  discover?(queries: AnnotatedQuery[], icp: ICP): Promise<DiscoveredLeadData[]>;
  /** Enrich a prospect with additional data (enrichment-capable adapters only) */
  enrich?(prospect: ProspectContext): Promise<Partial<ExtendedEnrichmentData>>;
}

// ---------------------------------------------------------------------------
// Query Generator
// ---------------------------------------------------------------------------

export interface AnnotatedQuery {
  query: string;
  vector: 'linkedin' | 'directory' | 'github' | 'twitter' | 'maps' | 'general';
}

export interface QueryGeneratorConfig {
  minQueries: number; // default: 5
  maxQueryLength: number; // default: 256
}

export interface QueryGeneratorResult {
  queries: AnnotatedQuery[];
  generationMethod: 'ai' | 'template_fallback';
}

// ---------------------------------------------------------------------------
// Prospect Context
// ---------------------------------------------------------------------------

export interface ProspectContext {
  name: string;
  company: string;
  role?: string;
  linkedinUrl?: string;
  companyDomain?: string;
  twitterHandle?: string;
  githubUsername?: string;
}

// ---------------------------------------------------------------------------
// Email Discovery
// ---------------------------------------------------------------------------

export interface EmailDiscoveryResult {
  email: string | null;
  verified: boolean;
  verificationMethod:
    | 'smtp_rcpt_to'
    | 'hunter_api'
    | 'pattern_inference'
    | 'github_commit'
    | 'website_scrape'
    | 'press_release';
  confidence: 'high' | 'medium' | 'low';
  companyDomain: string | null;
  isCatchAll: boolean;
}

export interface EmailCandidate {
  email: string;
  pattern: string; // e.g., "{first}.{last}"
  source: 'pattern_inference' | 'website_scrape' | 'github_commit' | 'press_release';
}

// ---------------------------------------------------------------------------
// SMTP Verification
// ---------------------------------------------------------------------------

export interface SMTPVerificationResult {
  email: string;
  valid: boolean;
  responseCode: number; // 250 = valid, 550 = invalid
  isCatchAll: boolean;
  confidence: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
  source: string;
  requestsPerMinute: number;
  dailyBudget: number;
}

export interface RateLimitStatus {
  source: string;
  currentMinuteCount: number;
  minuteLimit: number;
  dailyCount: number;
  dailyLimit: number;
  isExhausted: boolean;
  backoffUntil: Date | null;
}

// ---------------------------------------------------------------------------
// Source Health Monitor (Circuit Breaker)
// ---------------------------------------------------------------------------

export type SourceHealthState = 'healthy' | 'degraded' | 'disabled' | 'probing';

export interface SourceHealth {
  source: string;
  state: SourceHealthState;
  consecutiveFailures: number;
  lastFailureAt: Date | null;
  disabledUntil: Date | null;
  totalRequests: number;
  totalFailures: number;
}

// ---------------------------------------------------------------------------
// Anti-Detection
// ---------------------------------------------------------------------------

export interface AntiDetectionConfig {
  userAgents: string[];
  proxyList: string[];
  proxyEnabled: boolean;
  minDelay: number; // seconds
  maxDelay: number; // seconds
}

// ---------------------------------------------------------------------------
// Confidence Scorer
// ---------------------------------------------------------------------------

export interface FieldCorroboration {
  field: string;
  sources: string[];
  value: string;
}

// ---------------------------------------------------------------------------
// Pipeline Run Cache
// ---------------------------------------------------------------------------

export interface CachedCompanyData {
  websiteContent: string;
  teamMembers: { name: string; role: string }[];
  techStack: string[];
  emailPatterns: string[];
}

export interface RunCache {
  getCompanyData(domain: string): CachedCompanyData | null;
  setCompanyData(domain: string, data: CachedCompanyData): void;
  getMXRecords(domain: string): string[] | null;
  setMXRecords(domain: string, records: string[]): void;
  getEmailPattern(domain: string): string | null;
  setEmailPattern(domain: string, pattern: string): void;
  clear(): void;
}

// ---------------------------------------------------------------------------
// Source Configuration
// ---------------------------------------------------------------------------

export interface SourceConfig {
  // Proprietary source enable flags (all default true)
  googleSearchEnabled: boolean;
  linkedinScrapingEnabled: boolean;
  githubScrapingEnabled: boolean;
  twitterScrapingEnabled: boolean;
  directoryScrapingEnabled: boolean;
  mapsScrapingEnabled: boolean;
  smtpVerificationEnabled: boolean;

  // Premium adapter flags (all default false)
  apolloEnabled: boolean;
  apolloApiKey?: string;
  hunterEnabled: boolean;
  hunterApiKey?: string;
  clearbitEnabled: boolean;
  clearbitApiKey?: string;

  // Anti-detection
  proxyEnabled: boolean;
  proxyList: string[];

  // Rate limits (per minute)
  googleRateLimit: number;
  linkedinRateLimit: number;
  githubRateLimit: number;
  twitterRateLimit: number;
  smtpRateLimit: number;

  // Daily budgets
  dailyBudgetPerSource: number;
}

// ---------------------------------------------------------------------------
// AI Result Parser — Parsed Lead
// ---------------------------------------------------------------------------

export interface ParsedLead {
  name: string;
  role: string;
  company: string;
  linkedinUrl?: string;
  companyDomain?: string;
  confidence: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Waterfall Email Discovery
// ---------------------------------------------------------------------------

export interface WaterfallStep {
  method:
    | 'web_search'
    | 'pattern_inference'
    | 'hunter_api'
    | 'apollo_api'
    | 'smtp_verification'
    | 'research_agent_company'
    | 'research_agent_email';
  result: 'found' | 'not_found' | 'error';
  email?: string;
  verified?: boolean;
  duration_ms: number;
  error?: string;
}

export interface WaterfallEmailResult extends EmailDiscoveryResult {
  stepsAttempted: WaterfallStep[];
  finalMethod: string | null;
}

// ---------------------------------------------------------------------------
// Enrichment Retry Tracking
// ---------------------------------------------------------------------------

export interface EnrichmentRetryRecord {
  leadId: string;
  attempt: number;
  maxRetries: number;
  nextRetryAt: Date;
  lastError?: string;
}

// ---------------------------------------------------------------------------
// Structured Logging
// ---------------------------------------------------------------------------

export interface StructuredLogEntry {
  timestamp: string;
  stage: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  leadId?: string;
  source?: string;
  retryEligible?: boolean;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Query Retry Context
// ---------------------------------------------------------------------------

export interface QueryRetryContext {
  previousQueries: AnnotatedQuery[];
  resultsCount: number;
  missingVectors: string[];
  feedback: string;
}

// ---------------------------------------------------------------------------
// Creative Discovery Pipeline — Query History & Research Agent Types
// ---------------------------------------------------------------------------

export interface QueryHistoryEntry {
  id: string;
  icpProfileId: string;
  queryText: string;
  vector: AnnotatedQuery['vector'];
  executedAt: Date;
}

export interface CreativeQueryConfig extends QueryGeneratorConfig {
  maxQueryLength: 120;
  minQueries: 10;
  minVectors: 3;
  historyLookback: 200;
  overlapThresholdPct: 50;
  maxGenerationAttempts: 2;
}

export interface ResearchAgentCompanyResult {
  company: string | null;
  source: 'web_search' | 'content_extraction';
  confidence: 'high' | 'medium' | 'low';
}

export interface ResearchAgentEmailResult {
  email: string | null;
  hasMXRecords: boolean;
  source: 'research_agent_web_search';
  confidence: 'medium';
}
