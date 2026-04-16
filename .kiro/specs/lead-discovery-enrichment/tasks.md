# Implementation Plan: Proprietary Lead Discovery & Enrichment Engine

## Overview

This plan replaces the mock `discoverLeads()` and `enrichLead()` in `src/services/enrichmentService.ts` with a fully proprietary discovery and enrichment engine. Implementation proceeds bottom-up: types/interfaces first, then infrastructure (rate limiter, health monitor, anti-detection, cache, confidence scorer), then individual scrapers, then email discovery/SMTP verification, then premium adapters, then orchestration/integration, and finally wiring into the existing pipeline.

## Tasks

- [x] 1. Extend types and define core interfaces
  - [x] 1.1 Extend the `EnrichmentData` interface in `src/types/index.ts` with new optional fields: `email`, `emailVerified`, `emailVerificationMethod`, `linkedinUrl`, `companyDomain`, `dataConfidenceScore`, `lastVerifiedAt`, `dataSources`
    - All new fields must be optional to preserve backward compatibility with scoring service, message service, and quality gate
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9_
  - [x] 1.2 Extend the `DiscoveredLeadData` interface in `src/services/enrichmentService.ts` with new optional fields: `discoverySource`, `linkedinUrl`, `companyDomain`, `twitterHandle`, `githubUsername`
    - _Requirements: 18.3, 18.6_
  - [x] 1.3 Create `src/services/discovery/types.ts` with the `SourceAdapter` interface, `AnnotatedQuery`, `ProspectContext`, `ExtendedEnrichmentData`, `SourceConfig`, `RunCache` interface, and all shared types from the design document
    - Include `EmailDiscoveryResult`, `EmailCandidate`, `SMTPVerificationResult`, `RateLimiterConfig`, `RateLimitStatus`, `SourceHealth`, `SourceHealthState`, `AntiDetectionConfig`, `FieldCorroboration`, `CachedCompanyData`, `QueryGeneratorConfig`, `QueryGeneratorResult`
    - _Requirements: 1.4, 10.3, 11.1, 13.1, 14.1, 15.1, 16.5, 20.1_

- [x] 2. Implement infrastructure layer
  - [x] 2.1 Create `src/services/discovery/rateLimiter.ts` implementing the sliding-window rate limiter with daily budget enforcement
    - Implement `acquirePermit(source)` that blocks until the rate window resets (delays rather than drops)
    - Implement sliding window counter using in-memory timestamp arrays per source
    - Implement daily budget tracking that disables sources when exhausted
    - Implement exponential backoff on HTTP 429: `min(10 * 2^(N-1), 600)` seconds
    - Read rate limits from environment variables with defaults: GOOGLE=10/min, LINKEDIN=5/min, GITHUB=15/min, TWITTER=5/min, SMTP=20/min, daily budget=500/source
    - Log each rate limit event with source name, current count, limit, and backoff duration
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [ ]\* 2.2 Write property tests for rate limiter
    - [ ]\* 2.2.1 **Property 24: Rate limiter sliding window correctness** — for any sequence of timestamped requests to a source with rate limit L, the number of requests within any 60-second sliding window shall not exceed L
      - **Validates: Requirements 15.3**
    - [ ]\* 2.2.2 **Property 25: Rate limiter delays rather than drops** — for any sequence of requests to a rate-limited source, all requests shall eventually complete (none dropped)
      - **Validates: Requirements 15.2**
    - [ ]\* 2.2.3 **Property 26: Daily budget enforcement** — for any source with daily budget B, total requests within a calendar day shall not exceed B
      - **Validates: Requirements 15.4**
    - [ ]_ 2.2.4 **Property 27: Exponential backoff on HTTP 429** — for any N consecutive 429 responses, backoff duration shall be `min(10 _ 2^(N-1), 600)` seconds
      - **Validates: Requirements 15.6**

  - [x] 2.3 Create `src/services/discovery/healthMonitor.ts` implementing the circuit breaker pattern for source health monitoring
    - Implement `recordSuccess(source)` that resets consecutive failure count to 0
    - Implement `recordFailure(source)` that increments failure count and disables source after 5 consecutive failures
    - Implement `isSourceAvailable(source)` that checks health state and cooldown expiry
    - Implement `probeSource(source, adapter)` for re-enabling after cooldown with a single probe request
    - Implement `getHealthSummary()` returning health status for all sources (healthy, degraded, disabled)
    - Default cooldown: 15 minutes (configurable)
    - Log each state transition: healthy → disabled → probing → healthy
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

  - [ ]\* 2.4 Write property test for circuit breaker
    - **Property 28: Circuit breaker activation threshold** — source transitions to "disabled" if and only if 5+ consecutive failures; a single success resets count to 0
    - **Validates: Requirements 16.2**

  - [x] 2.5 Create `src/services/discovery/antiDetection.ts` implementing the Anti-Detection Manager
    - Implement `getNextUserAgent()` rotating from a pool of 20+ common browser User-Agent strings
    - Implement `getNextProxy()` rotating from the `SCRAPING_PROXY_LIST` env var (comma-separated)
    - Implement `getRandomDelay(min, max)` returning a random delay in the specified range
    - Implement `applyAntiDetection(page, domain)` that sets UA, proxy, and delay on a Playwright page
    - Implement `checkRobotsTxt(domain)` that checks robots.txt on first access and logs warnings for disallowed paths
    - Implement `shuffleAdapterOrder(adapters)` that returns a random permutation of the input array
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [ ]\* 2.6 Write property tests for anti-detection
    - [ ]\* 2.6.1 **Property 17: User-Agent rotation pool** — for N requests, all UAs come from a pool of 20+ distinct strings; for N >= 20, at least 2 distinct UAs used
      - **Validates: Requirements 13.1**
    - [ ]\* 2.6.2 **Property 18: Anti-detection delay bounds** — for any computed inter-request delay, the value shall be in [2, 10] seconds inclusive
      - **Validates: Requirements 13.2**
    - [ ]\* 2.6.3 **Property 19: Adapter order randomization preserves elements** — shuffle returns a permutation with same elements, same length, no duplicates added, no elements removed
      - **Validates: Requirements 13.6**

  - [x] 2.7 Create `src/services/discovery/runCache.ts` implementing the pipeline run cache
    - Implement in-memory Map-based cache keyed by normalized company domain
    - Implement `getCompanyData/setCompanyData`, `getMXRecords/setMXRecords`, `getEmailPattern/setEmailPattern`, `clear()`
    - Cache is created at pipeline run start and cleared at end
    - _Requirements: 19.6_

  - [x] 2.8 Create `src/services/discovery/confidenceScorer.ts` implementing the Confidence Scorer
    - Implement `scoreConfidence(corroborations)` that assigns scores based on source count: 3+ sources → 0.9+, 2 sources → 0.7, 1 source → 0.5 or below
    - Score always in [0.0, 1.0]
    - Premium API data weighted higher than single-source scrapes
    - _Requirements: 14.1, 14.2_

  - [ ]\* 2.9 Write property test for confidence scorer
    - **Property 20: Confidence score thresholds by source count** — 3+ sources → >= 0.9, 2 sources → ~0.7, 1 source → <= 0.5, always in [0.0, 1.0]
    - **Validates: Requirements 14.1, 14.2**

- [x] 3. Checkpoint — Ensure all infrastructure tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement AI-powered query generation
  - [x] 4.1 Create `src/services/discovery/queryGenerator.ts` implementing the Query Generator
    - Implement `generateQueries(icp, config?)` that uses the existing OpenAI integration to generate at least 5 distinct search queries from ICP fields (targetRole, industry, geography, companyStage, customTags)
    - Each query annotated with a discovery vector: linkedin, directory, github, twitter, maps, general
    - Queries must target multiple discovery vectors (LinkedIn profile searches, company directory searches, professional community searches)
    - Vary phrasing, synonyms, and keyword combinations across queries
    - Implement `generateFallbackQueries(icp)` with deterministic template-based queries as fallback when OpenAI fails
    - All queries must be URL-safe and not exceed 256 characters
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]\* 4.2 Write property tests for query generator
    - [ ]\* 4.2.1 **Property 1: Query Generator produces sufficient diverse queries** — for any valid ICP (non-empty targetRole and industry), returns at least 5 queries covering at least 3 distinct vector types
      - **Validates: Requirements 1.1, 1.2**
    - [ ]\* 4.2.2 **Property 2: Query validity and uniqueness** — all queries are unique, non-empty, annotated with valid vector, <= 256 chars, URL-safe characters only
      - **Validates: Requirements 1.3, 1.4, 1.6**

- [x] 5. Implement proprietary source scrapers
  - [x] 5.1 Install Playwright as a dependency and create `src/services/discovery/scraperUtils.ts` with shared Playwright browser management utilities
    - Add `playwright` to package.json dependencies
    - Create shared browser launch/close helpers, page creation with anti-detection applied
    - Create shared CAPTCHA detection utility
    - _Requirements: 2.1, 7.1, 13.1_

  - [x] 5.2 Create `src/services/discovery/googleSearchScraper.ts` implementing the Google Search Scraper source adapter
    - Implement `discover(queries, icp)` that executes each query against Google Search using Playwright
    - Extract result URLs, titles, and snippet text from the first 3 pages of results
    - Identify LinkedIn profile URLs by matching `linkedin.com/in/` pattern and extract name/headline from snippet
    - Identify directory pages (Crunchbase, AngelList, YC) and pass to Directory Scraper
    - Deduplicate results by normalized URL (case-insensitive, trailing slashes removed)
    - Handle CAPTCHAs by logging, aborting current query, and continuing with remaining queries
    - Randomized delay between 3 and 8 seconds between page loads
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]\* 5.3 Write property tests for Google Search Scraper utilities
    - [ ]\* 5.3.1 **Property 3: URL classification from search results** — LinkedIn URL identified iff contains `linkedin.com/in/`; directory page identified iff matches Crunchbase/AngelList/YC patterns
      - **Validates: Requirements 2.2, 2.3**
    - [ ]\* 5.3.2 **Property 4: Search result deduplication by normalized URL** — no two results share same normalized URL; output is subset of input
      - **Validates: Requirements 2.4**
    - [ ]\* 5.3.3 **Property 5: Scraping delay bounds (Google Search)** — delay in [3, 8] seconds inclusive
      - **Validates: Requirements 2.6**

  - [x] 5.4 Create `src/services/discovery/directoryScraper.ts` implementing the Directory Scraper source adapter
    - Implement Crunchbase extraction: company name, description, industry, employee count, funding stage, team members with roles
    - Implement AngelList/Wellfound extraction: company name, description, team members with roles
    - Implement Y Combinator extraction: company name, batch year, description, founders with roles
    - Filter extracted team members against ICP targetRole (semantic similarity matching)
    - Return `DiscoveredLeadData` objects with name, role, company, industry, geography
    - Handle page structure changes gracefully (log error, return empty)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]\* 5.5 Write property test for directory scraper role filtering
    - **Property 6: Role filtering against ICP target role** — only members with matching or semantically similar roles pass the filter
    - **Validates: Requirements 3.4**

  - [x] 5.6 Create `src/services/discovery/githubScraper.ts` implementing the GitHub Scraper source adapter
    - Implement discovery for technical roles (engineer, CTO, developer, architect, technical)
    - Scrape GitHub public web interface (not API) to avoid rate limits
    - Extract: display name, bio, company, location, repo count, contribution level, org memberships
    - Map profiles to `DiscoveredLeadData` objects
    - Skip profiles lacking company affiliation or real name
    - Extract email addresses from public commit history for Email Discovery Engine
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]\* 5.7 Write property test for GitHub profile completeness filter
    - **Property 7: GitHub profile completeness filter** — profile included iff both display name and company affiliation are non-empty
    - **Validates: Requirements 4.5**

  - [x] 5.8 Create `src/services/discovery/twitterScraper.ts` implementing the Twitter/X Scraper source adapter
    - Implement discovery via Twitter search results and profile pages
    - Extract: display name, bio, follower count, up to 10 recent tweets
    - Infer role, company, industry from bio and tweet content
    - Implement enrichment: enrich prospect data with bio text and recent tweets
    - Handle login walls by returning partial results
    - Rate limit: 5 requests per minute (configurable)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 5.9 Create `src/services/discovery/mapsScraper.ts` implementing the Google Maps Scraper source adapter
    - Search Google Maps for businesses matching ICP industry + geography
    - Extract: business name, address, website URL, phone, category
    - Pass website URLs to Company Website Scraper for team discovery
    - Deduplicate by normalized company name + address
    - Handle CAPTCHAs by logging and skipping
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.10 Create `src/services/discovery/linkedinScraper.ts` implementing the LinkedIn Scraper source adapter
    - Use Playwright to load public LinkedIn profile pages
    - Extract: headline, summary/bio, current job title, recent activity (up to 5 posts), photo URL, connection count, experience entries
    - Page load timeout: 30 seconds
    - Handle CAPTCHAs, login walls, HTTP 429 by returning partial results
    - Populate `linkedinBio` with headline + summary, `recentPosts` with activity posts
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]\* 5.11 Write property test for LinkedIn enrichment field mapping
    - **Property 8: LinkedIn enrichment field mapping** — headline+summary → `linkedinBio`, activity posts → `recentPosts`
    - **Validates: Requirements 7.6**

  - [x] 5.12 Create `src/services/discovery/companyWebsiteScraper.ts` implementing the Company Website Scraper source adapter
    - Navigate to company website, extract from about/team/product pages
    - Extract team member names+roles, tech stack mentions, company description
    - Format into `companyInfo` field as structured summary string
    - Scan for email patterns (contact pages, footer, team pages) and pass to Email Discovery Engine
    - Handle unreachable sites gracefully (empty companyInfo)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 5.13 Create `src/services/discovery/newsScraper.ts` implementing the News Scraper source adapter
    - Search Google News for prospect name + company (past 90 days)
    - Extract: headline, source name, publication date, snippet (up to 5 results)
    - Filter by verifying prospect/company name appears in snippet
    - Append to `recentPosts` array in EnrichmentData
    - Handle empty results gracefully
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]\* 5.14 Write property test for news result relevance filter
    - **Property 9: News result relevance filter** — result included iff snippet contains prospect name or company name (case-insensitive)
    - **Validates: Requirements 9.5**

- [x] 6. Checkpoint — Ensure all scraper tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement email discovery and SMTP verification
  - [x] 7.1 Create `src/services/discovery/emailDiscovery.ts` implementing the Email Discovery Engine
    - Implement `discoverEmail(prospect, cache)` orchestrating the full email discovery flow
    - Implement `extractCompanyDomain(prospect)` to extract primary domain from LinkedIn, Crunchbase, or Google Search results
    - Implement `lookupMXRecords(domain)` for DNS MX record lookups
    - Implement `generateCandidateEmails(firstName, lastName, domain)` generating exactly 6 patterns: `{first}@`, `{first}.{last}@`, `{f}{last}@`, `{first}{l}@`, `{first}_{last}@`, `{last}@` — all lowercased
    - Implement `inferEmailPattern(domain, knownEmails)` to detect company email naming pattern from scraped emails
    - Prioritize candidates matching detected pattern before non-matching candidates
    - Record discovery method in `emailVerificationMethod` field
    - Use RunCache for MX records and email patterns per company domain
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]\* 7.2 Write property tests for email discovery
    - [ ]\* 7.2.1 **Property 10: Email candidate pattern generation** — for any first name, last name, and domain, generates exactly 6 candidates following the specified patterns, all lowercased
      - **Validates: Requirements 10.3**
    - [ ]\* 7.2.2 **Property 11: Email candidate prioritization by detected pattern** — candidates matching detected pattern appear before non-matching, preserving relative order within each group
      - **Validates: Requirements 10.5**
    - [ ]\* 7.2.3 **Property 12: Email verification method recording** — for any email discovery result with an email found, `emailVerificationMethod` is exactly one of the valid values
      - **Validates: Requirements 10.6**

  - [x] 7.3 Create `src/services/discovery/smtpVerifier.ts` implementing the SMTP Verifier
    - Implement `verifyEmail(email, mxHost)` performing SMTP RCPT TO handshake (HELO → MAIL FROM → RCPT TO → QUIT)
    - Interpret 250 as valid mailbox, 550 as invalid
    - Implement `detectCatchAll(mxHost, domain)` by testing a known-invalid address (`randomstring12345@{domain}`)
    - Catch-all domains get "medium" confidence instead of "high"
    - Connection timeout: 10 seconds per handshake
    - Graceful QUIT after each verification
    - Handle unreachable MX servers: log failure, mark email as unverified
    - Include email in EnrichmentData only when valid (250 on non-catch-all) or likely_valid (250 on catch-all)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [ ]\* 7.4 Write property tests for SMTP verifier
    - [ ]\* 7.4.1 **Property 13: SMTP response code interpretation** — 250 → valid=true, 550 → valid=false
      - **Validates: Requirements 11.2**
    - [ ]\* 7.4.2 **Property 14: Catch-all domain confidence downgrade** — on catch-all domain, confidence is always "medium"
      - **Validates: Requirements 11.4**
    - [ ]\* 7.4.3 **Property 15: Verified email inclusion criteria** — email included (emailVerified=true) iff SMTP response is 250; catch-all gets "medium" confidence
      - **Validates: Requirements 11.7**

- [x] 8. Implement premium adapters (optional accelerators)
  - [x] 8.1 Create `src/services/discovery/premiumAdapters.ts` implementing Apollo, Hunter, and Clearbit premium adapters
    - Apollo adapter: discovery capability, enabled when `APOLLO_ENABLED=true` and `APOLLO_API_KEY` is set
    - Hunter adapter: enrichment capability (email verification), enabled when `HUNTER_ENABLED=true` and `HUNTER_API_KEY` is set
    - Clearbit adapter: enrichment capability (company data), enabled when `CLEARBIT_ENABLED=true` and `CLEARBIT_API_KEY` is set
    - All default to disabled — system works with zero paid APIs
    - Each adapter implements the `SourceAdapter` interface
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 9. Checkpoint — Ensure all email discovery and premium adapter tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement discovery and enrichment orchestration
  - [x] 10.1 Create `src/services/discovery/discoveryEngine.ts` implementing the Discovery Engine orchestrator
    - Implement the main discovery function that coordinates all enabled source adapters
    - Call Query Generator to produce search queries from ICP
    - Execute enabled discovery adapters (randomized order via Anti-Detection Manager)
    - Check source health via Health Monitor before each adapter call
    - Apply rate limiting via Rate Limiter for each request
    - Merge results from all sources and deduplicate by normalized name + company
    - Attach `discoverySource` identifier to each discovered prospect
    - Log empty results from individual adapters and continue with remaining
    - When multiple sources discover the same prospect, merge data preferring most complete fields
    - Return `DiscoveredLeadData[]` with name, role, company, industry, geography populated
    - Handle "all sources disabled" by returning empty result set with error log
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 20.5_

  - [ ]\* 10.2 Write property tests for discovery orchestration
    - [ ]\* 10.2.1 **Property 22: Discovery deduplication by normalized name and company** — no two prospects share same normalized name+company; output preserves most complete data
      - **Validates: Requirements 14.5, 18.2, 18.5**
    - [ ]\* 10.2.2 **Property 23: Discovered lead data completeness** — every returned prospect has non-empty name, role, company, and discoverySource
      - **Validates: Requirements 3.5, 18.3, 18.6**

  - [x] 10.3 Create `src/services/discovery/enrichmentPipeline.ts` implementing the Enrichment Pipeline orchestrator
    - Execute enrichment source adapters concurrently via `Promise.allSettled` with 90-second per-prospect timeout
    - Merge results from all adapters into a single `EnrichmentData` object
    - Prefer non-empty values over empty for scalar fields; concatenate array fields (recentPosts, dataSources)
    - When sources conflict on scalar fields, prefer highest-priority source (premium API > multi-source corroborated > single-source)
    - Record successful sources in `dataSources` array
    - Record failed/empty sources in `failedSources` array for backward compatibility
    - Call Email Discovery Engine for email discovery and SMTP verification
    - Call Confidence Scorer to compute `dataConfidenceScore`
    - Set `lastVerifiedAt` timestamp
    - Determine enrichment status: "complete" (all succeed), "partial" (some succeed, some fail), "pending" (all fail)
    - Deduplicate prospects across discovery runs by matching on normalized name+company, merging new data into existing records
    - Use RunCache for company-level data caching
    - Cancel pending sources on 90-second timeout and return partial result
    - _Requirements: 12.6, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_

  - [ ]\* 10.4 Write property tests for enrichment pipeline
    - [ ]\* 10.4.1 **Property 16: Enrichment data merge with source priority** — non-empty preferred over empty; arrays concatenated; premium > multi-source > single-source for conflicts
      - **Validates: Requirements 12.6, 19.2, 19.3**
    - [ ]\* 10.4.2 **Property 21: Data sources tracking accuracy** — `dataSources` contains exactly names of sources that contributed non-empty data
      - **Validates: Requirements 14.3**
    - [ ]\* 10.4.3 **Property 29: Enrichment status determination** — "complete" when F=0, "partial" when S>0 and F>0, "pending" when S=0
      - **Validates: Requirements 16.6**
    - [ ]\* 10.4.4 **Property 30: Failed sources tracking** — `failedSources` contains exactly names of adapters that threw errors or returned empty
      - **Validates: Requirements 19.4**

- [x] 11. Checkpoint — Ensure all orchestration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement source configuration and validation
  - [x] 12.1 Create `src/services/discovery/sourceConfig.ts` implementing source configuration loading
    - Read all source enable/disable flags from environment variables with defaults (proprietary sources default true, premium default false)
    - Read premium API keys from environment variables
    - Read proxy configuration from `SCRAPING_PROXY_LIST` and `SCRAPING_PROXY_ENABLED`
    - Read rate limit overrides from environment variables
    - Validate configuration on startup and log warnings for misconfigured or missing optional settings
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

- [x] 13. Wire into existing pipeline orchestrator and enrichment service
  - [x] 13.1 Replace the mock `discoverLeads()` function in `src/services/enrichmentService.ts` with the new Discovery Engine
    - The new implementation calls the Discovery Engine with the ICP and returns `DiscoveredLeadData[]`
    - Maintain the same function signature for backward compatibility with `pipelineOrchestratorService.ts`
    - _Requirements: 18.1, 18.6_
  - [x] 13.2 Replace the mock `enrichLead()` function in `src/services/enrichmentService.ts` with the new Enrichment Pipeline
    - The new implementation calls the Enrichment Pipeline with prospect context and returns `EnrichmentResult`
    - Maintain the same function signature and return type for backward compatibility
    - Replace mock `linkedinSource`, `recentPostsSource`, `companyInfoSource` with real source adapter orchestration
    - _Requirements: 19.1, 19.2, 19.3, 19.4_
  - [x] 13.3 Update `discoverAndEnrichLeads()` in `src/services/enrichmentService.ts` to create and clear the RunCache per pipeline run
    - Initialize RunCache at start of discovery+enrichment cycle
    - Clear RunCache after all prospects are processed
    - _Requirements: 19.6_
  - [x] 13.4 Update `executeDiscoveryStage()` in `src/services/pipelineOrchestratorService.ts` to use the new discovery and enrichment functions
    - Ensure the pipeline orchestrator's discovery stage works with the new real implementations
    - Verify backward compatibility: scoring service, message service, and quality gate continue working with extended EnrichmentData
    - _Requirements: 17.9, 18.1_

- [x] 14. Checkpoint — Ensure full integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Final integration and wiring
  - [ ]\* 15.1 Write integration tests for end-to-end discovery flow
    - Test discovery flow with mocked Playwright pages and mocked source responses
    - Verify deduplication, scoring, and enrichment data population
    - _Requirements: 18.1, 18.2, 18.5, 18.6_
  - [ ]\* 15.2 Write integration tests for end-to-end enrichment flow
    - Test enrichment flow with mocked source adapters
    - Verify data merge, confidence scoring, email discovery, and enrichment status determination
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_
  - [ ]\* 15.3 Write integration tests for SMTP verification flow
    - Test SMTP verification with mocked SMTP server connections
    - Verify catch-all detection, timeout handling, and graceful connection closure
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
  - [ ]\* 15.4 Write integration tests for pipeline orchestrator with new discovery/enrichment
    - Test that the pipeline orchestrator's discovery stage works end-to-end with the new engine
    - Verify backward compatibility with existing scoring, messaging, and quality gate services
    - _Requirements: 17.9, 18.1_

- [x] 16. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 30 universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- All new `EnrichmentData` fields are optional to preserve backward compatibility with existing consumers
- Playwright must be installed as a dependency for browser-based scraping
- The system works with zero paid APIs by default — all premium adapters are disabled unless explicitly enabled
