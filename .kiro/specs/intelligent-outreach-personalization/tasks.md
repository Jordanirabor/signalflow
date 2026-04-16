# Implementation Plan: Intelligent Outreach Personalization

## Overview

This plan implements the intelligent outreach personalization feature in incremental steps, extending the existing TypeScript/Next.js codebase. Each task builds on previous work, starting with types and data models, then core services, then API wiring. The design uses OpenAI for semantic analysis and the existing enrichment pipeline infrastructure.

## Tasks

- [x] 1. Extend types and database schema for Enriched ICP, Research Profile, and Correlation Score
  - [x] 1.1 Add Enriched ICP types and Research Profile types to `src/types/index.ts`
    - Add `EnrichedICP` interface extending `ICP` with `productDescription`, `valueProposition`, `painPointsSolved`, `competitorContext`, `idealCustomerCharacteristics`, `enrichmentGeneratedAt`
    - Add `ResearchProfile` interface with `leadId`, `topicsOfInterest`, `currentChallenges`, `recentActivity`, `publishedContentSummaries`, `overallSentiment`, `sourcesUsed`, `sourcesUnavailable`, `researchedAt`
    - Add `ResearchActivity` interface with `summary`, `source`, `timestamp`, `url`
    - Add `CorrelationScore` and `CorrelationBreakdown` interfaces
    - Add `PersonalizationContext`, `IntersectionAnalysis`, `PainPointMatch` interfaces
    - Add `PersonalizationMetadata`, `EnhancedMessageResponse`, `AutoResearchProgress` interfaces
    - _Requirements: 1.1, 1.2, 2.4, 3.2, 3.4, 4.1, 4.8, 5.3_

  - [x] 1.2 Create database migration for new columns
    - Add `product_description`, `value_proposition`, `pain_points_solved`, `competitor_context`, `ideal_customer_characteristics`, `enrichment_generated_at` columns to `icp` table
    - Add `research_profile` JSONB column to `lead` table
    - Add `correlation_score` NUMERIC(4,3), `correlation_breakdown` JSONB, `correlation_flag` VARCHAR(20) columns to `lead` table
    - _Requirements: 1.4, 2.8, 3.6_

- [x] 2. Implement Enriched ICP Generator
  - [x] 2.1 Extend `src/services/icpService.ts` with enriched ICP generation and persistence
    - Implement `generateEnrichedICP(productDescription, existingICP?)` that calls OpenAI to produce enrichment fields
    - Implement `saveEnrichedICP(input)` that stores enriched fields in the database
    - Implement `getEnrichedICP(founderId)` that retrieves the full Enriched ICP including new fields
    - On update, preserve manually edited base ICP fields and only regenerate enrichment fields
    - On AI failure, preserve existing Enriched ICP and return descriptive error
    - Validate `painPointsSolved` has 1–10 items, each ≤200 characters
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]\* 2.2 Write property test: Enriched ICP field completeness
    - **Property 1: Enriched ICP field completeness**
    - **Validates: Requirements 1.1**

  - [ ]\* 2.3 Write property test: Enriched ICP field preservation on regeneration
    - **Property 2: Enriched ICP field preservation on regeneration**
    - **Validates: Requirements 1.2, 1.3**

  - [ ]\* 2.4 Write property test: Pain points list constraints
    - **Property 3: Pain points list constraints**
    - **Validates: Requirements 1.6**

- [x] 3. Implement Prospect Researcher Service
  - [x] 3.1 Create `src/services/prospectResearcherService.ts` with source adapters and research orchestration
    - Implement `researchProspect(lead)` that executes all source adapters concurrently with `Promise.allSettled` and a 120-second timeout
    - Leverage existing source adapters (LinkedIn, Twitter, news, company website) from the enrichment pipeline and add blog/podcast/conference adapters
    - Merge partial results into a `ResearchProfile` with `topicsOfInterest`, `currentChallenges`, `recentActivity`, `publishedContentSummaries`, `overallSentiment`
    - Record unavailable sources in `sourcesUnavailable`
    - Set lead enrichment status to `"researching"` during execution, update to `"complete"` or `"partial"` on completion
    - Implement `getResearchProfile(leadId)` to retrieve stored profile from the `research_profile` JSONB column
    - Implement `isResearchStale(profile, thresholdDays)` to check if research is older than threshold
    - Store the Research Profile in the database associated with the lead record
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [ ]\* 3.2 Write property test: Research Profile output completeness with graceful degradation
    - **Property 4: Research Profile output completeness with graceful degradation**
    - **Validates: Requirements 2.4, 2.6**

  - [ ]\* 3.3 Write property test: Research Profile serialization round-trip
    - **Property 5: Research Profile serialization round-trip**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [ ]\* 3.4 Write property test: Research staleness detection
    - **Property 13: Research staleness detection**
    - **Validates: Requirements 5.7**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Correlation Engine
  - [x] 5.1 Create `src/services/correlationEngineService.ts` with dimension scorers and weighted aggregation
    - Implement `computeCorrelationScore(prospect, researchProfile, enrichedICP)` that computes the weighted total
    - Implement `computeRoleFit(prospectRole, icpTargetRole)` reusing logic from `scoringService.ts` scaled to 0.0–1.0
    - Implement `computeIndustryAlignment(prospectIndustry, icpIndustry)` with exact=1.0, partial=0.5, none=0.0
    - Implement `computePainPointOverlap(prospectChallenges, icpPainPoints)` using OpenAI embeddings with keyword-based fallback
    - Implement `computeBuyingSignalStrength(recentActivity)` scoring recency and volume of purchase-intent signals
    - Apply weights: roleFit 0.25, industryAlignment 0.25, painPointOverlap 0.35, buyingSignalStrength 0.15
    - Clamp all dimension scores to [0.0, 1.0] and handle NaN/Infinity by clamping to 0.0
    - Flag prospects with total score < 0.3 as `"low_correlation"`
    - Store correlation score, breakdown, and flag on the lead record
    - Implement `recalculateCorrelationScores(founderId)` for ICP update scenarios
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]\* 5.2 Write property test: Correlation score is weighted sum of dimensions
    - **Property 6: Correlation score is weighted sum of dimensions**
    - **Validates: Requirements 3.2, 3.3**

  - [ ]\* 5.3 Write property test: Correlation score bounded
    - **Property 7: Correlation score bounded**
    - **Validates: Requirements 3.4, 7.1**

  - [ ]\* 5.4 Write property test: Correlation score determinism
    - **Property 8: Correlation score determinism**
    - **Validates: Requirements 7.2**

  - [ ]\* 5.5 Write property test: Low correlation flag threshold
    - **Property 9: Low correlation flag threshold**
    - **Validates: Requirements 3.5**

- [x] 6. Implement Personalization Context Builder and Enhanced Message Generator
  - [x] 6.1 Create `src/services/personalizationContextBuilder.ts` with intersection analysis
    - Implement `buildPersonalizationContext(enrichedICP, researchProfile)` that assembles the full context
    - Implement `computeIntersectionAnalysis(icpPainPoints, prospectChallenges)` using OpenAI embeddings for semantic similarity
    - Implement `selectRecentContent(activities, maxAgeDays)` returning the most recent activity within threshold or null
    - Implement `selectBestPainPointMatch(matches)` returning the highest-similarity match
    - _Requirements: 4.1, 4.5_

  - [x] 6.2 Extend `src/services/messageService.ts` with enhanced personalization
    - Add `buildEnhancedPrompt(input)` that includes Research Profile content references, pain point intersection, and banned phrase avoidance instructions
    - Add `generateEnhancedMessage(input)` that uses the PersonalizationContext to generate hyper-personalized messages
    - Reference at least one specific recent content/activity from the Research Profile in the prompt
    - Address at least one pain point from the intersection analysis in the prompt
    - Instruct OpenAI to avoid banned phrases: "I hope this finds you well", "I came across your profile", "I wanted to reach out"
    - Prioritize content newer than 30 days
    - Enforce existing word limits (150 for DMs, 250 for emails)
    - Return `PersonalizationMetadata` (sources used, pain points referenced, content referenced) alongside the message
    - Fall back to existing generation when no Research Profile or Enriched ICP is available, setting `limitedPersonalization: true`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ]\* 6.3 Write property test: Recent content selection prioritizes recent activity
    - **Property 10: Recent content selection prioritizes recent activity**
    - **Validates: Requirements 4.5**

  - [ ]\* 6.4 Write property test: Empty research profile triggers limited personalization
    - **Property 11: Empty research profile triggers limited personalization**
    - **Validates: Requirements 4.6**

  - [ ]\* 6.5 Write property test: Banned phrase exclusion
    - **Property 12: Banned phrase exclusion**
    - **Validates: Requirements 4.4**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Auto-Research Orchestrator
  - [x] 8.1 Create `src/services/autoResearchOrchestrator.ts` with research-then-generate workflow
    - Implement `researchAndGenerate(lead, messageRequest, enrichedICP, onProgress?)` that coordinates the full workflow
    - Check if lead has an existing Research Profile; if missing or stale (>7 days), trigger the Prospect Researcher
    - Report progress through the callback with stages: `researching_linkedin`, `researching_twitter`, `researching_blogs`, `analyzing_content`, `generating_message`, `complete`, `failed`
    - On research completion, build PersonalizationContext and generate the message
    - Enforce 180-second total timeout
    - On complete research failure, fall back to Enriched ICP + basic lead info with `limitedPersonalization: true`
    - Implement `shouldRefreshResearch(profile)` returning true when profile is older than 7 days
    - Persist the Research Profile so subsequent generations don't repeat research
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]\* 8.2 Write unit tests for Auto-Research Orchestrator
    - Test progress callback stages
    - Test complete failure fallback
    - Test research not repeated when profile exists and is fresh
    - Test stale research triggers refresh
    - _Requirements: 5.1, 5.3, 5.5, 5.6, 5.7_

- [x] 9. Wire up API routes and integrate with existing pipeline
  - [x] 9.1 Extend `POST /api/icp/generate` route to accept `productDescription` and return Enriched ICP
    - Accept `productDescription` in request body
    - Call `generateEnrichedICP` and return the full Enriched ICP response
    - Handle AI failure with 502 status and preserve existing ICP
    - _Requirements: 1.1, 1.3, 1.5_

  - [x] 9.2 Extend `POST /api/messages/generate` route to auto-trigger research and return personalization metadata
    - Fetch lead's Research Profile; if missing, trigger auto-research via the orchestrator
    - Fetch Enriched ICP for the founder
    - Build PersonalizationContext and call `generateEnhancedMessage`
    - Return message with `PersonalizationMetadata` in the response
    - Fall back to existing generation when no enriched data is available
    - _Requirements: 4.1, 4.8, 5.1, 5.4_

  - [x] 9.3 Extend `POST /api/leads` route to trigger async deep research after lead creation
    - After creating a lead (discovered or manual), trigger `researchProspect` asynchronously
    - Set enrichment status to `"researching"` during execution
    - _Requirements: 2.1, 2.2, 2.7_

  - [x] 9.4 Create new API routes for research and correlation
    - Create `GET /api/leads/[id]/research` to fetch a lead's Research Profile
    - Create `POST /api/leads/[id]/research/refresh` to manually trigger research refresh
    - Create `GET /api/leads/[id]/correlation` to fetch a lead's Correlation Score breakdown
    - Extend `POST /api/leads/recalculate` to also recalculate Correlation Scores when ICP changes
    - _Requirements: 2.8, 3.6, 3.7_

  - [x] 9.5 Integrate Correlation Engine into the discovery pipeline
    - After discovery and enrichment in `enrichmentService.ts`, trigger correlation scoring for each new lead
    - Exclude leads flagged as `"low_correlation"` from automated outreach sequences
    - _Requirements: 3.1, 3.5_

  - [ ]\* 9.6 Write integration tests for API routes and pipeline wiring
    - Test ICP generation → storage → retrieval flow
    - Test lead creation → auto-research trigger → Research Profile storage
    - Test discovery → correlation scoring → low_correlation flagging
    - Test message generation with full personalization context
    - _Requirements: 1.4, 2.1, 2.2, 3.1, 3.5, 4.1, 5.1_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout, matching the existing codebase
- All new services follow the existing patterns in `src/services/`
- Database migrations should be run before implementing service logic
