# Implementation Plan: Automated Calendar Pipeline

## Overview

This plan implements the Automated Calendar Pipeline that transforms SignalFlow into an autonomous outreach engine. Tasks are ordered to build foundational layers first (database schema, shared types, configuration), then core services (email/calendar integrations, quality gates, response classifier, booking agent), then the pipeline orchestrator that wires everything together, and finally the frontend dashboard and monitoring views. The implementation builds on the existing Next.js + TypeScript + Postgres + OpenAI stack and reuses existing services (scoring, enrichment, message, throttle, outreach, CRM).

## Tasks

- [x] 1. Extend database schema and shared types for pipeline
  - [x] 1.1 Create database migration for pipeline tables and schema extensions
    - Create `src/lib/migrations/003_pipeline_schema.sql` with all new tables: `pipeline_config`, `pipeline_run`, `email_connection`, `calendar_connection`, `availability_window`, `incoming_reply`, `booking_proposal`, `calendar_event`
    - Add new columns to `lead` table: `email VARCHAR(255)`, `discovery_source VARCHAR(100)`, `discovered_at TIMESTAMPTZ`
    - Add new columns to `outreach_record` table: `gmail_thread_id VARCHAR(255)`, `gmail_message_id VARCHAR(255)`
    - Add indexes: `incoming_reply(gmail_thread_id)`, `pipeline_run(founder_id, started_at DESC)`, `booking_proposal(lead_id, status)`, `lead(email)`
    - Seed default availability windows (Mon–Fri 9:00–17:00) for the existing founder
    - _Requirements: 1.3, 8.6, 9.4_

  - [x] 1.2 Extend shared TypeScript types and interfaces
    - Add to `src/types/index.ts`: `PipelineRun`, `PipelineStatus`, `PipelineConfig`, `EmailConnection`, `IncomingReply`, `CalendarConnection`, `AvailabilityWindow`, `TimeSlot`, `CalendarEvent`, `ResponseClassification`, `ClassificationResult`, `BookingProposal`, `QualityCheckResult`, `QualityFailure`, `OutreachStrategy`, `PipelineMetrics`, `ConversationThread`, `ConversationMessage`, `ManualReviewItem`
    - _Requirements: 1.1, 1.6, 2.6, 3.1, 4.3, 6.1, 6.6, 7.1, 8.1, 9.1, 10.1, 11.1, 11.2, 12.1_

- [x] 2. Implement Pipeline Configuration and Strategy services
  - [x] 2.1 Implement Pipeline Configuration service
    - Create `src/services/pipelineConfigService.ts` with CRUD for pipeline config
    - Implement `validatePipelineConfig()` as a pure function: `runIntervalMinutes` in [15, 240], `dailyDiscoveryCap` in [10, 200], `maxFollowUps` in [1, 5], `minLeadScore` in [30, 90]
    - Return per-field error messages for out-of-range values
    - Provide sensible defaults for all parameters (interval: 60, cap: 50, follow-ups: 3, min score: 50, tone: professional, cadence: [3, 5, 7])
    - Create API routes: `GET /api/pipeline/config`, `PUT /api/pipeline/config`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ]\* 2.2 Write property test for pipeline configuration validation (Property 22)
    - **Property 22: Pipeline configuration validation**
    - Generate random config values; verify accepted iff all fields within ranges, and errors list exactly the out-of-range fields with allowed ranges
    - **Validates: Requirements 12.4, 12.5**

  - [x] 2.3 Implement Strategy service
    - Create `src/services/strategyService.ts` that manages outreach strategy inputs (product context, value proposition, target pain points, tone preference)
    - Strategy is stored as part of `PipelineConfig` — this service extracts and formats strategy for message generation
    - _Requirements: 3.1, 3.2, 3.4, 3.5_

- [x] 3. Implement Quality Gate service
  - [x] 3.1 Implement Quality Gate pure validation functions
    - Create `src/services/qualityGateService.ts` with composable pure functions:
      - `hasPersonalization(message, enrichmentData)` — passes iff message contains at least one enrichment element
      - `withinWordLimit(message, channel)` — rejects iff word count exceeds 150 (DM) or 250 (email)
      - `meetsScoreThreshold(leadScore, minScore)` — passes iff score >= threshold
      - `noDuplicateWithin24h(leadId, channel, outreachRecords)` — rejects iff same-channel send within 24h
      - `hasValidEmail(email)` — passes iff valid email format (one @, non-empty local/domain, domain has .)
      - `runAllChecks(...)` — composes all checks, returns `QualityCheckResult` with all failures
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7_

  - [ ]\* 3.2 Write property test for personalization check (Property 16)
    - **Property 16: Quality gate — personalization check**
    - Generate random message texts and enrichment data; verify gate passes iff message contains at least one enrichment element
    - **Validates: Requirements 10.1**

  - [ ]\* 3.3 Write property test for word count limit (Property 17)
    - **Property 17: Quality gate — word count limit**
    - Generate random messages of varying lengths and both channel types; verify gate rejects iff word count exceeds channel limit
    - **Validates: Requirements 10.2**

  - [ ]\* 3.4 Write property test for duplicate send prevention (Property 18)
    - **Property 18: Quality gate — duplicate send prevention**
    - Generate random outreach histories with timestamps; verify gate rejects iff same-channel send within 24h
    - **Validates: Requirements 10.5**

  - [ ]\* 3.5 Write property test for email validation (Property 19)
    - **Property 19: Quality gate — email validation**
    - Generate random strings (valid and invalid emails); verify gate passes iff valid email format
    - **Validates: Requirements 10.7**

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Email Integration service
  - [x] 5.1 Implement Email Integration service with Gmail OAuth
    - Create `src/services/emailIntegrationService.ts` with:
      - Gmail OAuth 2.0 flow (authorize URL generation, callback token exchange)
      - Token storage with AES-256-GCM encryption/decryption using server-side key
      - Automatic token refresh when within 5 minutes of expiry
      - `sendEmail(founderId, to, subject, body)` — sends via Gmail API, returns gmail_thread_id and gmail_message_id
      - `pollInbox(founderId, sinceTimestamp)` — fetches new replies matching outreach thread IDs
      - Connection verification by sending test message to founder's own address
      - Email signature appending to all outreach messages
      - Connection status check and deactivation on token revocation
    - Create API routes: `GET /api/oauth/gmail/authorize`, `GET /api/oauth/gmail/callback`, `GET /api/pipeline/email/status`, `DELETE /api/pipeline/email`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ]\* 5.2 Write property test for email signature appending (Property 15)
    - **Property 15: Email signature appending**
    - Generate random message bodies and signatures; verify composed message ends with the configured signature
    - **Validates: Requirements 9.6**

  - [ ]\* 5.3 Write property test for reply thread matching (Property 14)
    - **Property 14: Reply thread matching**
    - Generate random thread ID sets for inbox messages and outreach records; verify reply matched to outreach iff thread IDs equal, unmatched messages ignored
    - **Validates: Requirements 9.4**

- [x] 6. Implement Calendar Integration service
  - [x] 6.1 Implement Calendar Integration service with Google Calendar OAuth
    - Create `src/services/calendarIntegrationService.ts` with:
      - Google Calendar OAuth 2.0 flow (authorize URL generation, callback token exchange)
      - Token storage with AES-256-GCM encryption (same pattern as email)
      - `getAvailableSlots(founderId, startDate, endDate)` — reads existing events, computes free slots within availability windows
      - `createEvent(founderId, leadId, title, description, startTime, endTime, attendeeEmail)` — creates calendar event with invite
      - Connection verification by reading upcoming events
      - Availability window CRUD (per day-of-week start/end times)
      - Connection status check and deactivation on token revocation
    - Create API routes: `GET /api/oauth/calendar/authorize`, `GET /api/oauth/calendar/callback`, `GET /api/pipeline/calendar/status`, `GET /api/pipeline/calendar/slots`, `DELETE /api/pipeline/calendar`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]\* 6.2 Write property test for available slots computation (Property 13)
    - **Property 13: Available slots computation**
    - Generate random event sets (busy/free) and time ranges; verify available slots are exactly the free periods not overlapping busy events
    - **Validates: Requirements 8.3**

  - [ ]\* 6.3 Write property test for proposed slots within availability windows (Property 12)
    - **Property 12: Proposed slots within availability windows**
    - Generate random slots and availability window configs; verify every proposed slot falls entirely within an availability window
    - **Validates: Requirements 7.7**

- [x] 7. Implement Response Classifier service
  - [x] 7.1 Implement Response Classifier with OpenAI
    - Create `src/services/responseClassifierService.ts` with:
      - `classifyReply(replyText, conversationContext)` — calls OpenAI to classify reply into: interested, not_interested, objection, question, out_of_office
      - Returns `ClassificationResult` with classification, confidence (0.0–1.0), reasoning, and optional detected return date for out_of_office
      - Stores raw reply text, classification result, and confidence score in `incoming_reply` table
      - Flags replies with confidence < 0.7 for manual review
    - _Requirements: 6.1, 6.6, 6.7_

  - [ ]\* 7.2 Write property test for response classification validity (Property 9)
    - **Property 9: Response classification validity**
    - Generate random classification results; verify classification is exactly one of the 5 valid categories and confidence is in [0.0, 1.0]
    - **Validates: Requirements 6.1**

  - [ ]\* 7.3 Write property test for low-confidence manual review threshold (Property 10)
    - **Property 10: Low-confidence manual review threshold**
    - Generate random confidence scores [0.0–1.0]; verify reply flagged for manual review iff confidence < 0.7
    - **Validates: Requirements 6.7**

- [x] 8. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Booking Agent service
  - [x] 9.1 Implement Booking Agent
    - Create `src/services/bookingAgentService.ts` with:
      - `proposeSlots(founderId, leadId)` — queries calendar for available slots in next 7 business days, creates `BookingProposal` with up to 3 slots, sends proposal email
      - `handleSlotConfirmation(proposalId, confirmedSlot)` — creates calendar event, updates CRM status to Booked, records meeting date in status_change
      - `handleProposalExpiry(proposalId)` — after 48h with no response, sends follow-up with updated slots
      - `handleDecline(proposalId)` — proposes new slots from the following week
      - Respects founder's configured availability windows
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]\* 9.2 Write property test for booking proposal slot count (Property 11)
    - **Property 11: Booking proposal slot count**
    - Generate random available slot arrays of varying sizes; verify proposal contains exactly min(N, 3) slots
    - **Validates: Requirements 7.2**

- [x] 10. Implement Pipeline Orchestrator service
  - [x] 10.1 Implement Pipeline Orchestrator core and scheduling
    - Create `src/services/pipelineOrchestratorService.ts` with:
      - `executePipelineRun(founderId)` — creates pipeline_run record, executes stages sequentially (discovery → outreach → follow-up → inbox → booking), updates run status
      - Stage failure resilience: catch errors per stage, log in `stageErrors`, continue to next stage
      - Pipeline state management: running, paused, error states
      - Pause/resume: pause completes in-progress run before halting, resume schedules next run
      - `computeNextRunTime(config, lastRunTime)` — computes next run within business hours on business days
    - Create `src/services/pipelineSchedulerService.ts` with node-cron based scheduling that triggers pipeline runs at configured intervals during business hours
    - Create API routes: `POST /api/pipeline/run`, `POST /api/pipeline/pause`, `POST /api/pipeline/resume`, `GET /api/pipeline/status`, `GET /api/pipeline/runs`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ]\* 10.2 Write property test for next run time scheduling (Property 1)
    - **Property 1: Next run time scheduling**
    - Generate random timestamps, intervals, and business hour configs; verify computed next run time is the earliest valid time within business hours on a business day at the correct interval
    - **Validates: Requirements 1.1**

  - [ ]\* 10.3 Write property test for stage failure resilience (Property 2)
    - **Property 2: Stage failure resilience**
    - Generate random stage failure subsets; verify non-failing stages complete and stagesCompleted/stageErrors arrays are correct
    - **Validates: Requirements 1.4**

  - [x] 10.4 Implement automated discovery stage
    - Add discovery stage to orchestrator: query data sources for prospects matching ICP, score using existing scoringService, filter by minimum score threshold, enrich using enrichmentService, enforce daily discovery cap, skip duplicates, record discovery source and timestamp
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]\* 10.5 Write property test for score threshold filtering (Property 3)
    - **Property 3: Score threshold filtering**
    - Generate random lead scores and thresholds [30–90]; verify lead included in outreach queue iff score >= threshold
    - **Validates: Requirements 2.2, 10.3**

  - [ ]\* 10.6 Write property test for daily discovery cap enforcement (Property 4)
    - **Property 4: Daily discovery cap enforcement**
    - Generate random prospect counts and caps [10–200]; verify prospects added never exceeds daily cap
    - **Validates: Requirements 2.4**

  - [x] 10.7 Implement automated outreach stage
    - Add outreach stage to orchestrator: generate personalized messages using messageService with strategy inputs, run quality gate checks, send via emailIntegrationService, update CRM status to Contacted, record in outreach_record with gmail_thread_id, stagger sends with randomized delay (30–120s), respect throttle limits, queue overflow for next day
    - _Requirements: 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 10.4, 10.6_

  - [ ]\* 10.8 Write property test for stagger delay bounds (Property 6)
    - **Property 6: Stagger delay bounds**
    - Generate random delay values; verify every inter-message delay is in [30, 120] seconds inclusive
    - **Validates: Requirements 4.6**

  - [ ]\* 10.9 Write property test for outreach prompt completeness (Property 5)
    - **Property 5: Outreach prompt completeness**
    - Generate random product contexts, enrichment data, and conversation histories; verify prompt contains all required context elements
    - **Validates: Requirements 3.3, 5.3**

  - [x] 10.10 Implement automated follow-up stage
    - Add follow-up stage to orchestrator: check cadence intervals against last message timestamp, generate follow-up referencing conversation thread, mark as is_follow_up, enforce max follow-ups cap, move to Closed with reason "no_response" when max reached
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]\* 10.11 Write property test for follow-up cadence timing (Property 7)
    - **Property 7: Follow-up cadence timing**
    - Generate random timestamps and cadence intervals; verify follow-up due iff elapsed time >= cadence interval and prospect has not replied
    - **Validates: Requirements 5.1**

  - [ ]\* 10.12 Write property test for maximum follow-ups cap (Property 8)
    - **Property 8: Maximum follow-ups cap**
    - Generate random follow-up counts [0–10] and max values [1–5]; verify follow-up sent iff count < max, and CRM set to Closed when count >= max with no reply
    - **Validates: Requirements 5.2, 5.5**

  - [x] 10.13 Implement inbox monitoring and response processing stage
    - Add inbox stage to orchestrator: poll inbox via emailIntegrationService, match replies to outreach threads, classify via responseClassifierService, handle each classification:
      - interested → update CRM to Replied, pass to booking agent
      - not_interested → update CRM to Closed with reason
      - objection/question → generate contextual response, send via email
      - out_of_office → pause sequence, resume after return date
    - Flag low-confidence classifications for manual review
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 10.14 Implement booking stage integration
    - Add booking stage to orchestrator: process interested prospects via bookingAgentService, handle proposal creation, expiry follow-ups, and decline re-proposals
    - Update CRM to Booked on confirmed booking, record meeting date
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 11. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Pipeline Dashboard API routes and metrics
  - [x] 12.1 Implement pipeline metrics and conversation API routes
    - Create API routes:
      - `GET /api/pipeline/metrics` — daily pipeline metrics (prospects discovered, messages sent, replies received, meetings booked, reply rate)
      - `GET /api/pipeline/conversations` — list all conversation threads
      - `GET /api/pipeline/conversations/:leadId` — single conversation thread with all sent/received messages in chronological order
      - `GET /api/pipeline/review` — manual review queue (low-confidence classifications)
      - `POST /api/pipeline/review/:replyId` — resolve a manual review item
      - `GET /api/pipeline/calendar/week` — current week calendar with booked meetings
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]\* 12.2 Write property test for pipeline metrics computation (Property 20)
    - **Property 20: Pipeline metrics computation**
    - Generate random pipeline run records for a day; verify daily metrics equal sums of pipeline run fields, and reply rate = (replies / messages) \* 100 or 0 when no messages
    - **Validates: Requirements 11.2**

  - [ ]\* 12.3 Write property test for conversation thread chronological order (Property 21)
    - **Property 21: Conversation thread chronological order**
    - Generate random outbound/inbound message sets; verify merged thread is ordered chronologically by timestamp
    - **Validates: Requirements 11.3**

- [x] 13. Build frontend — Pipeline Dashboard and Monitoring
  - [x] 13.1 Create Pipeline Dashboard component
    - Build `src/components/PipelineDashboard.tsx` displaying:
      - Real-time pipeline status (running/paused/error) with last run timestamp and next scheduled run
      - Daily metrics cards: prospects discovered, messages sent, replies received, meetings booked, reply rate percentage
      - Controls to pause, resume, and manually trigger a pipeline run
      - Error notifications with details and suggested resolution
    - _Requirements: 11.1, 11.2, 11.4, 11.5_

  - [x] 13.2 Create Conversation Thread View component
    - Build `src/components/ConversationView.tsx` displaying:
      - List of all prospect conversation threads
      - Individual thread view with all sent/received messages in chronological order
      - Classification badges on inbound messages (interested, objection, etc.)
      - Confidence scores displayed on classified messages
    - _Requirements: 11.3_

  - [x] 13.3 Create Manual Review Queue component
    - Build `src/components/ManualReviewQueue.tsx` displaying:
      - List of prospects flagged for manual review (low-confidence classifications)
      - Reply text, suggested classification, and confidence score for each item
      - Action buttons to confirm or override the suggested classification
    - _Requirements: 11.6_

  - [x] 13.4 Create Calendar Week View component
    - Build `src/components/CalendarWeekView.tsx` displaying:
      - Current week calendar with booked meetings highlighted
      - Meeting details: prospect name, company, role, time, and context summary
      - Visual availability windows overlay
    - _Requirements: 11.7_

- [x] 14. Build frontend — Pipeline Configuration and Integration Setup
  - [x] 14.1 Create Pipeline Configuration component
    - Build `src/components/PipelineConfiguration.tsx` with:
      - Form fields for all pipeline parameters: run interval, discovery cap, sequence cadence, max follow-ups, min lead score, tone preference
      - Strategy inputs: product context, value proposition, target pain points
      - Input validation with error messages showing allowed ranges
      - Save button that applies config starting from next pipeline run
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 14.2 Create Email and Calendar Integration Setup components
    - Build `src/components/EmailIntegrationSetup.tsx` with:
      - Connect Gmail button initiating OAuth flow
      - Connection status display (connected/disconnected)
      - Sending name and email signature configuration
      - Disconnect button
    - Build `src/components/CalendarIntegrationSetup.tsx` with:
      - Connect Google Calendar button initiating OAuth flow
      - Connection status display
      - Availability window configuration (per day-of-week time ranges)
      - Disconnect button
    - _Requirements: 8.1, 8.2, 8.5, 8.6, 9.1, 9.2, 9.5, 9.6_

- [x] 15. Wire pipeline page and navigation
  - [x] 15.1 Create pipeline page and integrate all components
    - Create `src/app/pipeline/page.tsx` as the main pipeline page
    - Integrate PipelineDashboard, PipelineConfiguration, ConversationView, CalendarWeekView, ManualReviewQueue components with tab or section navigation
    - Add pipeline link to the main app navigation
    - Ensure dashboard loads within 3 seconds (use loading states, optimize queries)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 12.1_

- [x] 16. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- Property-based tests use fast-check and validate the 22 correctness properties defined in the design
- Checkpoints at tasks 4, 8, 11, and 16 ensure incremental validation
- All API routes use the existing `ApiError` format for consistent error handling
- OAuth tokens are encrypted at rest using AES-256-GCM with a server-side encryption key
- The pipeline reuses existing services (scoring, enrichment, message, throttle, outreach, CRM) rather than duplicating logic
- `node-cron` is used for scheduling pipeline runs; `googleapis` is used for Gmail and Calendar API integration
