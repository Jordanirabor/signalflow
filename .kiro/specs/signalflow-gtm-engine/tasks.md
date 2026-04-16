# Implementation Plan: SignalFlow GTM Intelligence Engine

## Overview

This plan implements the SignalFlow GTM Intelligence Engine as a Next.js monorepo with React frontend, Next.js API routes, Postgres database, PostHog analytics, and OpenAI GPT integration. Tasks are ordered to build foundational layers first (database, shared types, core services), then layer on features incrementally, wiring everything together at the end.

## Tasks

- [x] 1. Set up project structure, shared types, and database schema
  - [x] 1.1 Initialize Next.js project with TypeScript, install dependencies (pg, fast-check, posthog-js, openai)
    - Create directory structure: `src/lib/`, `src/services/`, `src/components/`, `src/app/api/`, `src/types/`, `src/__tests__/`
    - Configure TypeScript strict mode, ESLint, Prettier
    - _Requirements: 10.1_

  - [x] 1.2 Define shared TypeScript interfaces and types
    - Create `src/types/index.ts` with all interfaces: ICP, Lead, ScoreBreakdown, EnrichmentData, CRMStatus, OutreachRecord, StatusChange, CallNote, Tag, ThrottleConfig, ThrottleStatus, MessageRequest, MessageResponse, WeeklySummary, ApiError
    - Define type constants for CRM pipeline order: New(0), Contacted(1), Replied(2), Booked(3), Closed(4)
    - _Requirements: 1.1, 2.2, 3.5, 4.2, 5.1, 6.1, 7.1, 8.1, 9.1_

  - [x] 1.3 Create Postgres schema migration and database connection utility
    - Create `src/lib/db.ts` with connection pool setup
    - Create migration file with all 7 tables: FOUNDER, ICP, LEAD, OUTREACH_RECORD, STATUS_CHANGE, CALL_NOTE, TAG, THROTTLE_CONFIG
    - Add unique index on `LOWER(name), LOWER(company)` per `founderId` filtered to `isDeleted = false` for duplicate prevention
    - Add indexes on `leadScore DESC`, `crmStatus`, `createdAt`, and `leadId` on child tables
    - Implement soft delete columns (`isDeleted`, `deletedAt`) on LEAD table
    - _Requirements: 10.1, 10.4, 10.5_

  - [x] 1.4 Create shared API error handler utility
    - Create `src/lib/apiErrors.ts` implementing the ApiError interface with helper functions for 400, 409, 429, 500 responses
    - _Requirements: 10.3_

- [x] 2. Implement ICP Service and Scoring Service
  - [x] 2.1 Implement ICP validation and CRUD API routes
    - Create `src/services/icpService.ts` with validation logic: reject if `targetRole` or `industry` missing, return error listing missing field names
    - Create `POST /api/icp` route for create/update, `GET /api/icp` route for retrieval
    - On ICP save, trigger async lead score recalculation for all leads
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [ ]\* 2.2 Write property test for ICP validation (Property 1)
    - **Property 1: ICP validation and error reporting**
    - Generate arbitrary ICP input objects with optional `targetRole` and `industry`; verify rejection iff required fields missing and error lists exactly the missing fields
    - **Validates: Requirements 1.2, 1.5**

  - [x] 2.3 Implement Scoring Service with `calculateLeadScore` pure function
    - Create `src/services/scoringService.ts` implementing `calculateLeadScore(input: ScoringInput): ScoringOutput`
    - Score breakdown: `icpMatch` (0–40), `roleRelevance` (0–30), `intentSignals` (0–30), total clamped to [1, 100]
    - Ensure `icpMatch + roleRelevance + intentSignals == totalScore`
    - Create `POST /api/leads/recalculate` internal endpoint for batch recalculation triggered by ICP update
    - _Requirements: 3.1, 3.4, 3.5, 1.4_

  - [ ]\* 2.4 Write property test for lead score invariants (Property 2)
    - **Property 2: Lead score invariants**
    - Generate random valid lead+ICP pairs; verify totalScore in [1, 100], breakdown factors in sub-ranges, and breakdown sums to total
    - **Validates: Requirements 3.1, 3.5**

- [x] 3. Implement Lead Service
  - [x] 3.1 Implement Lead CRUD API routes
    - Create `src/services/leadService.ts` with lead creation, retrieval, update, soft delete, and restore logic
    - Create API routes: `POST /api/leads` (manual entry), `GET /api/leads` (list with filters), `GET /api/leads/:id`, `PATCH /api/leads/:id`, `DELETE /api/leads/:id` (soft delete), `POST /api/leads/:id/restore`
    - Enforce duplicate detection on `LOWER(name) + LOWER(company)` per founder, return 409 with existing lead ID
    - Default sort by `leadScore` descending; support `minScore` filter query param
    - _Requirements: 2.2, 2.5, 3.2, 3.3, 10.2, 10.4, 10.5_

  - [ ]\* 3.2 Write property test for lead list default sort order (Property 3)
    - **Property 3: Lead list default sort order**
    - Generate random lead arrays; verify default query returns leads sorted by `leadScore` descending
    - **Validates: Requirements 3.2**

  - [ ]\* 3.3 Write property test for minimum score filter (Property 4)
    - **Property 4: Lead list minimum score filter**
    - Generate random lead arrays and random threshold N; verify filter returns exactly leads with `leadScore >= N`
    - **Validates: Requirements 3.3**

  - [ ]\* 3.4 Write property test for duplicate lead detection (Property 20)
    - **Property 20: Duplicate lead detection**
    - Generate random name/company string pairs; verify duplicates detected case-insensitively and insertion prevented
    - **Validates: Requirements 10.4**

  - [x] 3.5 Implement lead discovery and enrichment
    - Create `POST /api/leads/discover` route that triggers discovery from public sources matching active ICP
    - Implement enrichment pipeline: fetch LinkedIn bio, recent posts, company info; set `enrichmentStatus` to `complete`, `partial`, or `pending`
    - On partial enrichment, populate `failedSources` array and mark lead as `partially enriched`
    - Score lead on creation/enrichment using Scoring Service
    - _Requirements: 2.1, 2.3, 2.4, 3.1_

- [ ] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Message Generator Service
  - [x] 5.1 Implement message generation API route with OpenAI integration
    - Create `src/services/messageService.ts` with LLM prompt construction using lead enrichment data, product context, tone preference
    - Create `POST /api/messages/generate` route accepting `MessageRequest`, returning `MessageResponse`
    - Include at least one specific enrichment detail in the prompt; set `limitedPersonalization = true` when all enrichment sources are empty
    - Enforce word count limits: 150 words for `cold_dm`, 250 words for `cold_email`
    - Handle LLM unavailability gracefully — return error allowing manual message writing
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7_

  - [ ]\* 5.2 Write property test for limited personalization flag (Property 5)
    - **Property 5: Limited personalization flag**
    - Generate random EnrichmentData objects; verify `limitedPersonalization` is true iff all of `linkedinBio`, `recentPosts`, `companyInfo` lack usable content
    - **Validates: Requirements 4.6**

  - [ ]\* 5.3 Write property test for message word count limits (Property 6)
    - **Property 6: Message word count limits**
    - Generate random message strings and message types; verify cold_dm ≤ 150 words and cold_email ≤ 250 words
    - **Validates: Requirements 4.7**

- [-] 6. Implement Outreach Tracking and Throttle Services
  - [x] 6.1 Implement Throttle Service
    - Create `src/services/throttleService.ts` with daily outreach counting per channel, warning at 80%, blocking at 100%
    - Create `GET /api/throttle/status` returning current usage, limits, remaining capacity, and warning flag
    - Create `PUT /api/throttle/config` for updating limits; validate range [5, 50], reject out-of-range with error
    - Default throttle: 20 per channel per day
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]\* 6.2 Write property test for throttle enforcement (Property 9)
    - **Property 9: Throttle enforcement**
    - Generate random limits L and usage counts C; verify `warningThreshold = true` when `C >= 0.8 * L` and outreach rejected when `C >= L`
    - **Validates: Requirements 5.5, 9.2, 9.3**

  - [ ]\* 6.3 Write property test for throttle limit range validation (Property 10)
    - **Property 10: Throttle limit range validation**
    - Generate random integers; verify accepted iff in [5, 50], rejected otherwise with error
    - **Validates: Requirements 9.4, 9.5**

  - [x] 6.4 Implement Outreach Tracking API routes
    - Create `src/services/outreachService.ts` with outreach recording, history retrieval, and stale lead detection
    - Create `POST /api/outreach` (throttle-checked via Throttle Service before recording), `GET /api/outreach/:leadId` (chronological history), `GET /api/outreach/stale` (leads contacted 7+ days ago with no reply)
    - Record outreach date, channel, message content, and follow-up flag
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]\* 6.5 Write property test for outreach history chronological order (Property 7)
    - **Property 7: Outreach history chronological order**
    - Generate random OutreachRecord arrays; verify history returned in chronological order by `outreachDate`
    - **Validates: Requirements 5.2**

  - [ ]\* 6.6 Write property test for stale outreach filter (Property 8)
    - **Property 8: Stale outreach filter**
    - Generate random leads with outreach dates and statuses; verify stale filter returns exactly leads with most recent outreach > 7 days AND crmStatus not in {Replied, Booked, Closed}
    - **Validates: Requirements 5.4**

- [x] 7. Implement CRM Pipeline Service
  - [x] 7.1 Implement CRM status transition API routes
    - Create `src/services/crmService.ts` with status change logic, validation for backward moves (require reason), and meeting date requirement for Booked status
    - Create `PATCH /api/crm/:leadId/status` for status changes, `GET /api/crm/pipeline` for grouped view with counts, support filters: status, minScore, maxScore, lastActivityAfter
    - Record each status change in STATUS_CHANGE table with timestamp
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]\* 7.2 Write property test for backward status move requires reason (Property 13)
    - **Property 13: Backward status move requires reason**
    - Generate random status transitions; verify backward moves rejected without reason, forward/same moves don't require reason
    - Pipeline order: New(0) → Contacted(1) → Replied(2) → Booked(3) → Closed(4)
    - **Validates: Requirements 6.6**

  - [ ]\* 7.3 Write property test for CRM status aggregate counts (Property 11)
    - **Property 11: CRM status aggregate counts**
    - Generate random non-deleted leads with various statuses; verify sum of counts equals total non-deleted leads
    - **Validates: Requirements 6.3, 8.2**

  - [ ]\* 7.4 Write property test for pipeline multi-filter correctness (Property 12)
    - **Property 12: Pipeline multi-filter correctness**
    - Generate random leads and random filter combinations; verify every result satisfies all filters and no excluded lead satisfies all filters
    - **Validates: Requirements 6.5**

- [ ] 8. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Insight Extractor Service
  - [x] 9.1 Implement post-call insight capture API routes
    - Create `src/services/insightService.ts` with call note submission, LLM-based tag generation, sentiment inference, and aggregation
    - Create `POST /api/insights/:leadId` for submitting call notes — parse free text, generate tags via LLM, infer sentiment if empty
    - Create `GET /api/insights/:leadId` returning call notes in reverse chronological order
    - Create `GET /api/insights/aggregate` returning top pain points, objections, feature requests sorted by frequency
    - Handle LLM tag generation failure: store raw text, set `tagGenerationFailed = true`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]\* 9.2 Write property test for call notes reverse chronological order (Property 14)
    - **Property 14: Call notes reverse chronological order**
    - Generate random CallNote arrays; verify notes returned in reverse chronological order by `createdAt`
    - **Validates: Requirements 7.3**

  - [ ]\* 9.3 Write property test for aggregated insights frequency ranking (Property 15)
    - **Property 15: Aggregated insights frequency ranking**
    - Generate random call notes with tags; verify tags sorted by descending frequency within each category and reported counts match actual counts
    - **Validates: Requirements 7.4**

- [-] 10. Implement Dashboard Service and Summary Metrics
  - [x] 10.1 Implement dashboard summary API route
    - Create `src/services/dashboardService.ts` with weekly summary computation: leadsContacted, replyRate, meetingsBooked, conversionRate, statusCounts, upcomingMeetings, highPrioritySuggestions, lowMeetingPrompt
    - Create `GET /api/dashboard/summary` route
    - Upcoming meetings: leads with Booked status and future meetingDate, sorted ascending
    - High-priority suggestions: leads with score > 80 and crmStatus == 'New'
    - Low meeting prompt: shown when < 3 meetings booked this week
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6_

  - [ ]\* 10.2 Write property test for weekly summary metric calculations (Property 16)
    - **Property 16: Weekly summary metric calculations**
    - Generate random outreach records and status changes within a week; verify leadsContacted, replyRate, meetingsBooked computed correctly
    - **Validates: Requirements 8.1**

  - [ ]\* 10.3 Write property test for upcoming meetings filter (Property 17)
    - **Property 17: Upcoming meetings filter**
    - Generate random leads with Booked status and meeting dates; verify list contains exactly future-dated meetings sorted ascending
    - **Validates: Requirements 8.4**

  - [ ]\* 10.4 Write property test for high-priority lead suggestions (Property 18)
    - **Property 18: High-priority lead suggestions**
    - Generate random non-deleted leads; verify suggestions contain exactly leads with score > 80 AND status New
    - **Validates: Requirements 8.5**

  - [ ]\* 10.5 Write property test for low meeting prompt trigger (Property 19)
    - **Property 19: Low meeting prompt trigger**
    - Generate random meeting counts; verify prompt displayed iff count < 3
    - **Validates: Requirements 8.6**

- [ ] 11. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Build frontend — ICP and Lead Management views
  - [x] 12.1 Create ICP Definition Form component
    - Build React form with fields: target role, industry, company stage, geography, custom tags
    - Inline validation errors for missing required fields (target role, industry)
    - On submit, call `POST /api/icp`; show success/error feedback
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 12.2 Create Lead List View component
    - Build sortable, filterable lead table displaying: name, role, company, industry, geography, Lead_Score with breakdown
    - Implement minimum score filter input and default descending score sort
    - Support manual lead entry via inline form or modal; show 409 duplicate error as toast with link to existing lead
    - Implement soft delete with restore option; reflect changes within 2 seconds
    - _Requirements: 2.2, 2.5, 3.2, 3.3, 3.5, 10.2, 10.4, 10.5_

  - [x] 12.3 Create Lead Detail View component
    - Show full lead details including enrichment data, score breakdown, outreach history, call notes, and CRM status
    - Provide actions: generate message, record outreach, change CRM status, add call note
    - Show enrichment status badge (complete/partial/pending) with failed sources if partial
    - _Requirements: 2.2, 2.4, 3.5, 5.2_

- [x] 13. Build frontend — Message Editor, Outreach, and CRM views
  - [x] 13.1 Create Message Editor component
    - Build message generation UI: select message type (cold_email/cold_dm), tone (professional/casual/direct), provide product context
    - Display generated message in editable textarea; show personalization details and limited personalization flag
    - Handle LLM errors gracefully — allow manual message writing
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 13.2 Create Outreach Tracking UI
    - Build outreach recording form: channel selection, message content (pre-filled from generator), follow-up toggle
    - Display chronological outreach history per lead
    - Show throttle warning banner at 80% usage; block recording at 100% with remaining time until reset
    - Implement stale leads view (contacted 7+ days ago, no reply)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 9.2, 9.3_

  - [x] 13.3 Create CRM Pipeline View component
    - Build Kanban-style pipeline with 5 columns: New, Contacted, Replied, Booked, Closed
    - Display aggregate counts per column
    - Implement drag-and-drop or button-based status transitions; prompt for reason on backward moves, meeting date on Booked
    - Support filtering by status, score range, and last activity date
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 14. Build frontend — Insights and Dashboard views
  - [x] 14.1 Create Post-Call Insight Form component
    - Build structured form with fields: pain points, objections, feature requests, next steps, sentiment selector
    - On submit, call `POST /api/insights/:leadId`; show tag generation results or manual tagging fallback
    - Display call notes list in reverse chronological order per lead
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_

  - [x] 14.2 Create Dashboard Summary Page
    - Build dashboard with weekly summary metrics: leads contacted, reply rate, meetings booked, conversion rate
    - Display CRM status counts, upcoming meetings list, high-priority suggestions, and low meeting prompt
    - Ensure dashboard loads within 3 seconds (optimize queries, use loading states)
    - Integrate PostHog analytics tracking on key user actions
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 14.3 Create Throttle Configuration UI
    - Build settings form for configuring daily throttle limits per channel (email, DM)
    - Validate range [5, 50]; show error for out-of-range values
    - Display current throttle status with usage bars
    - _Requirements: 9.1, 9.4, 9.5_

- [x] 15. Implement error handling, data integrity, and client-side resilience
  - [x] 15.1 Implement client-side error handling patterns
    - 400 errors: inline field-level validation messages
    - 409 (duplicate lead): toast with link to existing lead
    - 429 (throttle): warning banner with remaining capacity and reset time
    - 500 errors: generic error toast, retain form state for retry
    - Network failure: offline indicator, queue action for retry on reconnect
    - _Requirements: 10.3, 10.4, 5.5, 9.3_

  - [x] 15.2 Implement soft delete cleanup job
    - Create a utility or API route to purge soft-deleted records older than 30 days
    - _Requirements: 10.5_

- [ ] 16. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- Property-based tests use fast-check and validate the 20 correctness properties defined in the design
- Checkpoints at tasks 4, 8, 11, and 16 ensure incremental validation
- All API routes use the shared ApiError format for consistent error handling
- PostHog integration is client-side only; silent failure if unavailable
