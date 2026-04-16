# Requirements Document: Proprietary Lead Discovery & Enrichment Engine

## Introduction

This feature replaces the hardcoded mock implementations in `enrichmentService.ts` — specifically `discoverLeads()` and `enrichLead()` — with a fully proprietary discovery and enrichment engine that operates at zero external API cost. The core engine uses web scraping (Google Search, LinkedIn, Crunchbase, GitHub, Twitter/X, company websites), AI-powered query generation (via the existing OpenAI integration), and direct SMTP email verification to discover real prospects, enrich their profiles, and find verified email addresses. Paid APIs (Apollo.io, Hunter.io, Clearbit) are supported only as optional premium accelerators behind feature flags — the system works perfectly with all premium adapters disabled. The engine integrates with the existing pipeline orchestrator, respects rate limits, implements anti-detection measures, and produces enrichment data that feeds directly into the scoring service and message personalization.

## Glossary

- **Discovery_Engine**: The component that finds real prospects matching the founder's ICP using proprietary scraping and AI-powered query generation, replacing the current mock `discoverLeads()` function
- **Enrichment_Pipeline**: The component that gathers verified professional and contact data about a discovered prospect from multiple proprietary sources, replacing the current mock `enrichLead()` function
- **Source_Adapter**: A pluggable module that wraps a specific scraping target or optional API behind a common interface
- **Google_Search_Scraper**: The Source_Adapter that scrapes Google Search results to discover prospect LinkedIn profiles, company pages, and professional directories matching the ICP
- **LinkedIn_Scraper**: The Source_Adapter that uses Playwright to extract public profile data (headline, bio, experience, recent activity, photo URL, connection count) from LinkedIn profiles
- **Company_Website_Scraper**: The Source_Adapter that scrapes company websites to extract about page content, team members, product descriptions, tech stack mentions, and email patterns
- **GitHub_Scraper**: The Source_Adapter that scrapes GitHub profiles and organization pages to discover technical decision-makers and extract repos, contributions, bio, and org memberships
- **Twitter_Scraper**: The Source_Adapter that scrapes Twitter/X profiles to extract bio, recent tweets, and follower count for discovered prospects
- **Directory_Scraper**: The Source_Adapter that scrapes Crunchbase, AngelList/Wellfound, and Y Combinator company pages to discover startups and their team members
- **News_Scraper**: The Source_Adapter that scrapes Google News results for recent mentions of a prospect or their company
- **Maps_Scraper**: The Source_Adapter that scrapes Google Maps and business listings for geographic prospect targeting
- **Email_Discovery_Engine**: The component that discovers and verifies email addresses using proprietary methods: domain extraction, pattern inference, and SMTP verification
- **SMTP_Verifier**: The component that connects to a company's MX server and performs RCPT TO handshake to verify whether a mailbox exists without sending an email
- **Query_Generator**: The AI component that uses OpenAI to generate varied, effective search queries from the ICP definition to maximize discovery coverage
- **Rate_Limiter**: The component that tracks request counts per Source_Adapter and enforces per-source rate limits to prevent excessive resource usage
- **Source_Health_Monitor**: The component that tracks success/failure rates per Source_Adapter and temporarily disables unhealthy sources via a circuit breaker pattern
- **Anti_Detection_Manager**: The component that manages User-Agent rotation, request throttling, randomized delays, and proxy rotation to avoid scraping detection
- **Confidence_Scorer**: The component that assigns a confidence score to discovered data based on how many independent sources corroborate the information
- **Premium_Adapter**: An optional Source_Adapter that wraps a paid third-party API (Apollo.io, Hunter.io, Clearbit) and is disabled by default
- **Enrichment_Data**: The structured data object containing a prospect's profile data, email, verification status, confidence score, and source attribution, as defined in `src/types/index.ts`
- **ICP**: The Ideal Customer Profile defining target role, industry, company stage, geography, and custom tags used to filter discovered prospects

## Requirements

### Requirement 1: AI-Powered Search Query Generation

**User Story:** As a founder, I want the system to generate smart, varied search queries from my ICP definition, so that discovery covers the widest possible range of matching prospects without me crafting queries manually.

#### Acceptance Criteria

1. WHEN the Discovery_Engine begins a discovery run, THE Query_Generator SHALL use the existing OpenAI integration to generate at least 5 distinct Google Search query strings from the active ICP's targetRole, industry, geography, companyStage, and customTags fields
2. THE Query_Generator SHALL produce queries targeting multiple discovery vectors including LinkedIn profile searches (e.g., `site:linkedin.com/in "{targetRole}" "{industry}"`), company directory searches, and professional community searches
3. THE Query_Generator SHALL vary query phrasing, synonyms, and keyword combinations across generated queries to maximize coverage and reduce result overlap
4. THE Query_Generator SHALL accept the ICP object and return an array of query strings, each annotated with the intended discovery vector (linkedin, directory, github, twitter, maps)
5. IF the OpenAI API call fails during query generation, THEN THE Query_Generator SHALL fall back to a set of deterministic template-based queries constructed from the ICP fields
6. THE Query_Generator SHALL generate queries that are safe for URL encoding and do not exceed 256 characters per query string

### Requirement 2: Google Search Prospect Discovery

**User Story:** As a founder, I want the system to scrape Google Search results to find real LinkedIn profiles and professional pages matching my ICP, so that I can discover prospects without paying for any API subscriptions.

#### Acceptance Criteria

1. WHEN the Discovery_Engine executes a discovery run, THE Google_Search_Scraper SHALL execute each query string from the Query_Generator against Google Search using Playwright and extract the result URLs, titles, and snippet text from the first 3 pages of results
2. THE Google_Search_Scraper SHALL identify LinkedIn profile URLs from search results by matching the pattern `linkedin.com/in/` and extract the prospect's name and headline from the search snippet
3. THE Google_Search_Scraper SHALL identify company directory pages (Crunchbase, AngelList, Y Combinator) from search results and pass them to the Directory_Scraper for team member extraction
4. THE Google_Search_Scraper SHALL deduplicate results across queries by normalizing URLs before returning the combined result set
5. IF the Google_Search_Scraper encounters a CAPTCHA challenge, THEN THE Google_Search_Scraper SHALL log the CAPTCHA event, abort the current query, and continue with remaining queries
6. THE Google_Search_Scraper SHALL wait a randomized delay between 3 and 8 seconds between page loads to reduce detection probability

### Requirement 3: Company Directory Scraping

**User Story:** As a founder, I want the system to scrape startup directories like Crunchbase, AngelList, and Y Combinator pages, so that I can discover companies and their team members matching my ICP without paid data providers.

#### Acceptance Criteria

1. WHEN the Directory_Scraper receives a Crunchbase company URL, THE Directory_Scraper SHALL use Playwright to extract the company name, description, industry, employee count, funding stage, and listed team members with their roles
2. WHEN the Directory_Scraper receives an AngelList/Wellfound company URL, THE Directory_Scraper SHALL extract the company name, description, listed team members, and their roles
3. WHEN the Directory_Scraper receives a Y Combinator company page URL, THE Directory_Scraper SHALL extract the company name, batch year, description, and listed founders with their roles
4. THE Directory_Scraper SHALL filter extracted team members against the ICP's targetRole field and return only members whose role matches or is semantically similar to the target role
5. THE Directory_Scraper SHALL return discovered team members as `DiscoveredLeadData` objects containing name, role, company, industry, and geography fields
6. IF a directory page structure has changed and extraction fails, THEN THE Directory_Scraper SHALL log the parsing error with the URL and return an empty result without affecting other sources

### Requirement 4: GitHub Technical Decision-Maker Discovery

**User Story:** As a founder, I want the system to find technical decision-makers through GitHub profiles and organization pages, so that I can discover engineering leaders and CTOs who are active in open source.

#### Acceptance Criteria

1. WHEN the Discovery_Engine targets technical roles (containing "engineer", "CTO", "developer", "architect", or "technical" in the ICP targetRole), THE GitHub_Scraper SHALL search GitHub organization pages and user profiles matching the ICP criteria
2. THE GitHub_Scraper SHALL extract from each GitHub profile: display name, bio, company affiliation, location, public repository count, contribution activity level, and organization memberships
3. THE GitHub_Scraper SHALL map extracted GitHub profiles to `DiscoveredLeadData` objects, using the bio and company fields to populate role and company
4. THE GitHub_Scraper SHALL use the GitHub public web interface (not the API) to avoid API rate limits and authentication requirements
5. IF a GitHub profile lacks a company affiliation or real name, THEN THE GitHub_Scraper SHALL skip the profile and log the incomplete data
6. THE GitHub_Scraper SHALL extract email addresses from public GitHub commit history when available and pass them to the Email_Discovery_Engine for verification

### Requirement 5: Twitter/X Prospect Discovery and Enrichment

**User Story:** As a founder, I want the system to find and enrich prospects through Twitter/X profiles, so that I can discover decision-makers active in tech discussions and gather additional context for personalization.

#### Acceptance Criteria

1. WHEN the Discovery_Engine executes Twitter-targeted queries, THE Twitter_Scraper SHALL scrape Twitter/X search results and profile pages to find prospects matching the ICP criteria
2. THE Twitter_Scraper SHALL extract from each Twitter/X profile: display name, bio, follower count, and up to 10 recent tweets
3. THE Twitter_Scraper SHALL use the bio and recent tweet content to infer the prospect's role, company, and industry when not explicitly stated
4. WHEN the Enrichment_Pipeline processes a prospect with a known Twitter handle, THE Twitter_Scraper SHALL enrich the prospect's data with bio text and recent tweets for message personalization
5. IF Twitter/X blocks the scraping request or returns a login wall, THEN THE Twitter_Scraper SHALL log the block event and return a partial result without the blocked data
6. THE Twitter_Scraper SHALL respect a configurable rate limit (default: 5 requests per minute) to avoid triggering Twitter/X anti-bot measures

### Requirement 6: Google Maps Geographic Prospect Discovery

**User Story:** As a founder, I want the system to discover prospects through Google Maps and business listings, so that I can target companies and decision-makers in specific geographic areas defined in my ICP.

#### Acceptance Criteria

1. WHEN the ICP includes a geography field, THE Maps_Scraper SHALL search Google Maps for businesses matching the ICP's industry in the specified geographic area
2. THE Maps_Scraper SHALL extract from each business listing: business name, address, website URL, phone number, and business category
3. THE Maps_Scraper SHALL pass extracted website URLs to the Company_Website_Scraper for team member and contact discovery
4. THE Maps_Scraper SHALL return discovered businesses as partial `DiscoveredLeadData` objects with the company and geography fields populated
5. IF Google Maps returns a CAPTCHA or blocks the request, THEN THE Maps_Scraper SHALL log the event and skip geographic discovery for the current run
6. THE Maps_Scraper SHALL deduplicate businesses by normalized company name and address before returning results

### Requirement 7: LinkedIn Public Profile Enrichment

**User Story:** As a founder, I want the system to scrape public LinkedIn profile data for discovered prospects, so that enrichment data includes professional context for highly personalized outreach messages.

#### Acceptance Criteria

1. WHEN the Enrichment_Pipeline processes a prospect with a LinkedIn profile URL, THE LinkedIn_Scraper SHALL use Playwright to load the public LinkedIn profile page and extract the headline, summary/bio text, and current job title
2. THE LinkedIn_Scraper SHALL extract up to 5 recent activity posts from the LinkedIn profile's public activity section when available
3. THE LinkedIn_Scraper SHALL extract the prospect's profile photo URL, connection count (approximate), and current experience entries (company name, role, duration)
4. THE LinkedIn_Scraper SHALL set a page load timeout of 30 seconds per scraping request to prevent pipeline stalls
5. IF the LinkedIn_Scraper encounters a CAPTCHA, login wall, or HTTP 429 response, THEN THE LinkedIn_Scraper SHALL abort the scrape, log the block event, and return a partial result without the blocked data
6. THE LinkedIn_Scraper SHALL populate the Enrichment_Data `linkedinBio` field with the extracted headline and summary text, and the `recentPosts` field with extracted activity posts

### Requirement 8: Company Website Scraping and Enrichment

**User Story:** As a founder, I want the system to scrape company websites for about page content, team members, and tech stack information, so that outreach messages can reference specific company details.

#### Acceptance Criteria

1. WHEN the Enrichment_Pipeline processes a prospect, THE Company_Website_Scraper SHALL navigate to the prospect's company website and extract content from the about page, team page, and product pages
2. THE Company_Website_Scraper SHALL extract team member names and roles from the company's team or about page when available
3. THE Company_Website_Scraper SHALL extract technology stack mentions from the company website (frameworks, languages, tools referenced in job postings, blog posts, or product pages)
4. THE Company_Website_Scraper SHALL format extracted company data into the Enrichment_Data `companyInfo` field as a structured summary string
5. IF the company website is unreachable or returns an error, THEN THE Company_Website_Scraper SHALL log the error and set the `companyInfo` field to empty without failing the enrichment
6. THE Company_Website_Scraper SHALL scan the company website for email address patterns (e.g., in contact pages, footer, team pages) and pass discovered patterns to the Email_Discovery_Engine

### Requirement 9: News and Press Mention Enrichment

**User Story:** As a founder, I want the system to find recent news and press mentions about prospects and their companies, so that outreach messages can reference timely, relevant events.

#### Acceptance Criteria

1. WHEN the Enrichment_Pipeline processes a prospect, THE News_Scraper SHALL search Google News for recent mentions of the prospect's name and company name from the past 90 days
2. THE News_Scraper SHALL extract the headline, source name, publication date, and snippet text from up to 5 relevant news results
3. THE News_Scraper SHALL append extracted news mentions to the Enrichment_Data `recentPosts` array alongside LinkedIn activity posts
4. IF Google News returns no results for a prospect, THEN THE News_Scraper SHALL log the empty result and continue without affecting other enrichment sources
5. THE News_Scraper SHALL filter out irrelevant results by verifying that the prospect's name or company name appears in the article snippet text

### Requirement 10: Proprietary Email Discovery

**User Story:** As a founder, I want the system to discover prospect email addresses using proprietary methods at zero API cost, so that the outreach pipeline has verified contacts without paying for Hunter.io or similar services.

#### Acceptance Criteria

1. WHEN the Enrichment_Pipeline processes a prospect without an email address, THE Email_Discovery_Engine SHALL extract the company's primary domain by scraping the company website URL from LinkedIn, Crunchbase, or Google Search results
2. THE Email_Discovery_Engine SHALL perform DNS MX record lookups on the extracted company domain to verify that the domain has active mail servers
3. THE Email*Discovery_Engine SHALL generate candidate email addresses using common patterns: {first}@{domain}, {first}.{last}@{domain}, {f}{last}@{domain}, {first}{l}@{domain}, {first}*{last}@{domain}, and {last}@{domain}, using the prospect's first and last name
4. THE Email_Discovery_Engine SHALL scan the company website, public GitHub commits, and press releases for email addresses matching the company domain to infer the company's email naming pattern
5. WHEN the Email_Discovery_Engine detects an email pattern from existing company emails, THE Email_Discovery_Engine SHALL prioritize candidate addresses matching the detected pattern
6. THE Email_Discovery_Engine SHALL record the method used to discover each email address (pattern_inference, website_scrape, github_commit, press_release) in the Enrichment_Data `emailVerificationMethod` field

### Requirement 11: SMTP Email Verification

**User Story:** As a founder, I want the system to verify discovered email addresses by checking directly with the mail server, so that only valid addresses are used for outreach — without paying for email verification APIs.

#### Acceptance Criteria

1. WHEN the Email_Discovery_Engine has generated candidate email addresses, THE SMTP_Verifier SHALL connect to the company's MX server (resolved via DNS) and perform an SMTP RCPT TO handshake for each candidate address
2. THE SMTP_Verifier SHALL interpret a 250 response code from the RCPT TO command as a valid mailbox and a 550 response code as an invalid mailbox
3. THE SMTP_Verifier SHALL detect catch-all mail servers (domains that accept all addresses) by testing a known-invalid address (e.g., `randomstring12345@{domain}`) before verifying real candidates
4. WHEN a catch-all domain is detected, THE SMTP_Verifier SHALL mark the email verification confidence as "medium" instead of "high" and log the catch-all detection
5. THE SMTP_Verifier SHALL set a connection timeout of 10 seconds per SMTP handshake to prevent pipeline stalls
6. IF the MX server is unreachable or rejects the connection, THEN THE SMTP_Verifier SHALL log the failure and mark the email as unverified without failing the enrichment
7. THE SMTP_Verifier SHALL include the verified email in the Enrichment_Data only when the SMTP verification result is "valid" (250 response on a non-catch-all domain) or "likely_valid" (250 response on a catch-all domain)
8. THE SMTP_Verifier SHALL close SMTP connections gracefully with a QUIT command after each verification to avoid being flagged as abusive

### Requirement 12: Optional Premium API Integrations

**User Story:** As a founder, I want to optionally connect paid API services like Apollo.io, Hunter.io, and Clearbit as premium accelerators, so that I can get faster or higher-volume results when I choose to pay for them.

#### Acceptance Criteria

1. WHEN the environment variable `APOLLO_ENABLED` is set to "true" and `APOLLO_API_KEY` is configured, THE Discovery_Engine SHALL include the Apollo Premium_Adapter as an additional discovery source alongside the proprietary scrapers
2. WHEN the environment variable `HUNTER_ENABLED` is set to "true" and `HUNTER_API_KEY` is configured, THE Enrichment_Pipeline SHALL include the Hunter Premium_Adapter as an additional email verification source alongside the SMTP_Verifier
3. WHEN the environment variable `CLEARBIT_ENABLED` is set to "true" and `CLEARBIT_API_KEY` is configured, THE Enrichment_Pipeline SHALL include the Clearbit Premium_Adapter as an additional company enrichment source alongside the Company_Website_Scraper
4. THE Discovery_Engine SHALL default all Premium_Adapter enable flags (`APOLLO_ENABLED`, `HUNTER_ENABLED`, `CLEARBIT_ENABLED`) to "false" so the system operates with zero paid API dependencies by default
5. THE Discovery_Engine SHALL function with identical core capabilities when all Premium_Adapters are disabled, using only proprietary scraping and SMTP verification
6. WHEN a Premium_Adapter is enabled, THE Enrichment_Pipeline SHALL merge premium data with proprietary data, preferring premium data for fields where both sources provide values

### Requirement 13: Anti-Detection and Scraping Resilience

**User Story:** As a founder, I want the system to use anti-detection measures when scraping, so that scraping sources remain accessible over time and the system operates reliably.

#### Acceptance Criteria

1. THE Anti_Detection_Manager SHALL rotate User-Agent strings from a pool of at least 20 common browser User-Agent strings across all scraping requests
2. THE Anti_Detection_Manager SHALL insert randomized delays between 2 and 10 seconds between consecutive scraping requests to the same domain
3. THE Anti_Detection_Manager SHALL support a configurable proxy list via the `SCRAPING_PROXY_LIST` environment variable (comma-separated proxy URLs) and rotate proxies across requests
4. WHEN a scraping request encounters a CAPTCHA challenge, THE Anti_Detection_Manager SHALL log the CAPTCHA event, mark the current source as temporarily blocked, and trigger the circuit breaker for that source
5. THE Anti_Detection_Manager SHALL check robots.txt for each target domain on first access and log a warning when scraping paths disallowed by robots.txt
6. THE Anti_Detection_Manager SHALL randomize the order in which Source_Adapters are executed across discovery runs to avoid predictable access patterns

### Requirement 14: Data Quality and Confidence Scoring

**User Story:** As a founder, I want the system to cross-reference data from multiple sources and assign confidence scores, so that I can trust the accuracy of discovered prospect data.

#### Acceptance Criteria

1. WHEN the Enrichment_Pipeline collects data for a prospect from multiple sources, THE Confidence_Scorer SHALL assign a `dataConfidenceScore` between 0.0 and 1.0 based on the number of independent sources that corroborate each data field
2. THE Confidence_Scorer SHALL assign a score of 0.9 or above when 3 or more independent sources agree on a data field value, 0.7 when 2 sources agree, and 0.5 or below when only a single source provides the value
3. THE Enrichment_Pipeline SHALL record the list of sources that contributed data to each prospect's enrichment in the Enrichment_Data `dataSources` array field
4. THE Enrichment_Pipeline SHALL track data freshness by recording the timestamp of the most recent verification in the Enrichment_Data `lastVerifiedAt` field
5. THE Enrichment_Pipeline SHALL deduplicate prospects across discovery runs by matching on normalized name and company, merging new data into existing records rather than creating duplicates
6. THE Email_Discovery_Engine SHALL verify all discovered email addresses via the SMTP_Verifier before marking them as usable for outreach

### Requirement 15: Rate Limiting and Quota Management

**User Story:** As a founder, I want the system to enforce per-source rate limits and daily scraping budgets, so that scraping targets are not overwhelmed and the system operates sustainably.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL enforce per-source rate limits configurable via environment variables: `GOOGLE_RATE_LIMIT` (default: 10 requests per minute), `LINKEDIN_RATE_LIMIT` (default: 5 requests per minute), `GITHUB_RATE_LIMIT` (default: 15 requests per minute), `TWITTER_RATE_LIMIT` (default: 5 requests per minute), and `SMTP_RATE_LIMIT` (default: 20 verifications per minute)
2. WHEN a Source_Adapter call would exceed the configured rate limit, THE Rate_Limiter SHALL delay the request until the rate window resets rather than dropping the request
3. THE Rate_Limiter SHALL use a sliding window counter to track request counts per source per minute
4. THE Rate_Limiter SHALL enforce a configurable daily scraping budget per source via environment variables (default: 500 requests per source per day) to prevent excessive resource usage
5. WHEN the daily budget for a source is exhausted, THE Rate_Limiter SHALL disable that source for the remainder of the calendar day and log the budget exhaustion event
6. WHEN a Source_Adapter returns an HTTP 429 response, THE Rate_Limiter SHALL apply exponential backoff starting at 10 seconds, doubling on each consecutive 429, up to a maximum backoff of 10 minutes
7. THE Rate_Limiter SHALL log each rate limit event with the source name, current count, limit, and backoff duration

### Requirement 16: Source Health Monitoring and Circuit Breaker

**User Story:** As a founder, I want the system to automatically detect and handle source failures, so that a single broken scraping target does not stop the entire discovery and enrichment process.

#### Acceptance Criteria

1. IF a Source_Adapter throws an error during a discovery or enrichment call, THEN THE Source_Health_Monitor SHALL increment the failure count for that source and allow the pipeline to continue with remaining sources
2. WHEN a Source_Adapter accumulates 5 consecutive failures, THE Source_Health_Monitor SHALL disable the source for a configurable cooldown period (default: 15 minutes)
3. WHEN the cooldown period expires for a disabled source, THE Source_Health_Monitor SHALL re-enable the source with a single probe request before resuming full traffic
4. THE Source_Health_Monitor SHALL log each source state transition (healthy to disabled, disabled to probing, probing to healthy) with the source name, failure count, and timestamp
5. THE Source_Health_Monitor SHALL expose a health status summary for all sources (healthy, degraded, disabled) accessible via an internal function call for dashboard integration
6. THE Enrichment_Pipeline SHALL determine enrichment status as "complete" when all enabled sources succeed, "partial" when at least one source succeeds and at least one fails, and "pending" when all sources fail

### Requirement 17: Enrichment Data Structure Extension

**User Story:** As a founder, I want enrichment data to include email addresses, verification status, confidence scores, and source attribution, so that the outreach pipeline can send to verified contacts and the quality gate can validate data quality.

#### Acceptance Criteria

1. THE Enrichment_Data type SHALL include an `email` field of type string containing the prospect's discovered email address
2. THE Enrichment_Data type SHALL include an `emailVerified` field of type boolean indicating whether the email passed SMTP verification or premium API verification
3. THE Enrichment_Data type SHALL include an `emailVerificationMethod` field of type string indicating how the email was verified (smtp_rcpt_to, hunter_api, pattern_inference, github_commit)
4. THE Enrichment_Data type SHALL include a `linkedinUrl` field of type string containing the prospect's LinkedIn profile URL when discovered
5. THE Enrichment_Data type SHALL include a `companyDomain` field of type string containing the prospect's company website domain
6. THE Enrichment_Data type SHALL include a `dataConfidenceScore` field of type number (0.0 to 1.0) representing the overall confidence in the enrichment data accuracy
7. THE Enrichment_Data type SHALL include a `lastVerifiedAt` field of type Date recording when the enrichment data was last verified
8. THE Enrichment_Data type SHALL include a `dataSources` field of type string array listing all sources that contributed data to the enrichment (e.g., "linkedin_scrape", "github_scrape", "smtp_verify", "company_website")
9. THE Enrichment_Pipeline SHALL preserve backward compatibility with existing Enrichment_Data consumers (scoring service, message service, quality gate) by keeping the existing `linkedinBio`, `recentPosts`, `companyInfo`, and `failedSources` fields unchanged

### Requirement 18: Multi-Source Discovery Orchestration

**User Story:** As a founder, I want the discovery engine to coordinate multiple proprietary sources efficiently, so that each discovery run produces the most comprehensive prospect list possible.

#### Acceptance Criteria

1. WHEN the Pipeline_Orchestrator executes the discovery stage, THE Discovery_Engine SHALL query all enabled Source_Adapters for prospects matching the active ICP
2. THE Discovery_Engine SHALL merge results from all sources and deduplicate by matching on normalized name and company
3. THE Discovery_Engine SHALL attach a `discoverySource` identifier (e.g., "google_search", "crunchbase_scrape", "github_scrape", "apollo_api") to each discovered prospect for traceability
4. IF a Source_Adapter returns zero results, THEN THE Discovery_Engine SHALL log the empty result and continue querying remaining adapters
5. WHEN multiple sources discover the same prospect, THE Discovery_Engine SHALL merge the data from all sources into a single prospect record, preferring the most complete data for each field
6. THE Discovery_Engine SHALL return discovered prospects as `DiscoveredLeadData` objects containing name, role, company, industry, and geography fields populated from the source data

### Requirement 19: Enrichment Pipeline Orchestration

**User Story:** As a founder, I want the enrichment pipeline to coordinate multiple proprietary and optional premium sources efficiently, so that each prospect gets the most complete data possible without unnecessary requests.

#### Acceptance Criteria

1. WHEN enriching a prospect, THE Enrichment_Pipeline SHALL execute Source_Adapters concurrently (Promise.all) rather than sequentially to minimize total enrichment time
2. THE Enrichment_Pipeline SHALL merge results from all Source_Adapters into a single Enrichment_Data object, preferring non-empty values and concatenating array fields (recentPosts, dataSources)
3. WHEN multiple sources return conflicting values for the same field, THE Enrichment_Pipeline SHALL prefer the value from the highest-confidence source (premium API data > multi-source corroborated scrape > single-source scrape)
4. THE Enrichment_Pipeline SHALL record sources that failed or returned empty in the `failedSources` field for backward compatibility
5. THE Enrichment_Pipeline SHALL complete enrichment for a single prospect within 90 seconds; IF the 90-second timeout is exceeded, THEN THE Enrichment_Pipeline SHALL cancel pending source requests and return whatever data has been collected so far as a partial result
6. THE Enrichment_Pipeline SHALL cache company-level data (company website content, MX records, email patterns) keyed by normalized company domain for the duration of a pipeline run to avoid redundant scraping for prospects at the same company

### Requirement 20: Source Configuration

**User Story:** As a founder, I want to configure which discovery and enrichment sources the system uses, proxy settings, and rate limit overrides, so that I can control system behavior and optionally add premium API keys.

#### Acceptance Criteria

1. THE Discovery_Engine SHALL support enabling or disabling individual Source_Adapters via environment variables: `GOOGLE_SEARCH_ENABLED` (default: "true"), `LINKEDIN_SCRAPING_ENABLED` (default: "true"), `GITHUB_SCRAPING_ENABLED` (default: "true"), `TWITTER_SCRAPING_ENABLED` (default: "true"), `DIRECTORY_SCRAPING_ENABLED` (default: "true"), `MAPS_SCRAPING_ENABLED` (default: "true"), `SMTP_VERIFICATION_ENABLED` (default: "true")
2. THE Discovery_Engine SHALL read optional premium API keys from environment variables: `APOLLO_API_KEY`, `HUNTER_API_KEY`, `CLEARBIT_API_KEY`
3. WHEN a premium API key environment variable is set and the corresponding enable flag is "true", THE Discovery_Engine SHALL activate the Premium_Adapter for that service
4. THE Anti_Detection_Manager SHALL read proxy configuration from the `SCRAPING_PROXY_LIST` environment variable (comma-separated proxy URLs) and the `SCRAPING_PROXY_ENABLED` environment variable (default: "false")
5. WHEN all Source_Adapters are disabled, THE Discovery_Engine SHALL return an empty result set and log an error message "No data sources available for discovery"
6. THE Discovery_Engine SHALL validate configuration on startup and log warnings for any misconfigured or missing optional settings
