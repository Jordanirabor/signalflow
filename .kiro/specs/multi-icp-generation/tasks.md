# Implementation Plan: Multi-ICP Generation

## Overview

Replace the single-ICP-per-founder model with a multi-ICP system. Implementation proceeds incrementally: types first, then database migration, then services (profile CRUD, generator, query generator, scoring, discovery), then API endpoints, then pipeline integration, then UI components. Each step builds on the previous and is wired in before moving forward.

## Tasks

- [x] 1. Define ICPProfile type and ScoreBreakdownV2 in shared types
  - [x] 1.1 Add ICPProfile interface to `src/types/index.ts`
    - Add `ICPProfile` with fields: id, founderId, targetRole, industry, companyStage?, geography?, painPoints (string[]), buyingSignals (string[]), customTags?, isActive (boolean), createdAt, updatedAt
    - Add `ICPSet` interface with founderId, profiles (ICPProfile[]), activeCount
    - Add `ScoreBreakdownV2` with icpMatch (0–25), roleRelevance (0–25), intentSignals (0–30), painPointRelevance (0–20)
    - Add `ScoringInputV2` with lead pick and icpProfile: ICPProfile
    - Preserve existing `ICP`, `ScoreBreakdown`, `ScoringInput` types for backward compatibility
    - _Requirements: 2.1_

- [x] 2. Database migration for icp_profile table and lead.icp_profile_id
  - [x] 2.1 Create migration file `src/lib/migrations/006_multi_icp_profile.sql`
    - Create `icp_profile` table with id (UUID PK), founder_id (FK), target_role, industry, company_stage, geography, pain_points (TEXT[] NOT NULL DEFAULT '{}'), buying_signals (TEXT[] NOT NULL DEFAULT '{}'), custom_tags, is_active (BOOLEAN DEFAULT true), created_at, updated_at
    - Add CHECK constraints: pain_points 1–10 entries, buying_signals 1–5 entries
    - Add indexes: idx_icp_profile_founder, idx_icp_profile_active (partial WHERE is_active = true)
    - Migrate existing `icp` rows into `icp_profile`, copying target_role, industry, company_stage, geography, custom_tags, setting pain_points = COALESCE(pain_points_solved, '{}'), buying_signals = '{}', is_active = true
    - Add `icp_profile_id` UUID column to `lead` table with FK to icp_profile(id) ON DELETE SET NULL
    - Backfill lead.icp_profile_id from founder's migrated profile
    - Add idx_lead_icp_profile index
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.6_

- [x] 3. Implement ICP Profile Service
  - [x] 3.1 Create `src/services/icpProfileService.ts` with validation functions
    - Implement `validateICPProfile(input)` — reject missing targetRole, industry, or zero painPoints
    - Implement `validatePainPoints(painPoints)` — accept 1–10 entries, each non-empty and ≤200 chars
    - Implement `validateBuyingSignals(signals)` — accept 1–5 entries, each non-empty and ≤200 chars
    - _Requirements: 2.2, 2.3, 3.5_

  - [ ]\* 3.2 Write property tests for validation functions (Properties 4, 5, 6)
    - **Property 4: Pain points validation** — random string arrays, accept 1–10 non-empty ≤200 char entries, reject all others
    - **Validates: Requirements 2.2**
    - **Property 5: Buying signals validation** — random string arrays, accept 1–5 non-empty ≤200 char entries, reject all others
    - **Validates: Requirements 2.3**
    - **Property 6: Manual ICP_Profile creation validation** — reject missing targetRole/industry/zero painPoints, accept valid inputs
    - **Validates: Requirements 3.5**

  - [x] 3.3 Implement CRUD and set management functions in `src/services/icpProfileService.ts`
    - Implement `getICPSet(founderId)` — return all profiles ordered by created_at ASC
    - Implement `getActiveProfiles(founderId)` — return only isActive = true profiles
    - Implement `getICPProfileById(id)` — single profile lookup
    - Implement `createICPProfile(input)` — insert with isActive defaulting to true, validate before save
    - Implement `updateICPProfile(id, input)` — partial update, update updatedAt timestamp
    - Implement `deleteICPProfile(id)` — delete profile record (leads retained via ON DELETE SET NULL)
    - Implement `setProfileActive(id, isActive)` — toggle active/inactive
    - Implement `replaceICPSet(founderId, profiles)` — delete existing profiles, insert new set in a transaction
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]\* 3.4 Write property tests for active filtering and ordering (Properties 7, 8, 9)
    - **Property 7: Active profile filtering** — mixed active/inactive profiles, getActiveProfiles returns only isActive = true
    - **Validates: Requirements 3.3, 4.1**
    - **Property 8: Activate/deactivate round trip** — deactivate then activate results in profile being in active set
    - **Validates: Requirements 3.4**
    - **Property 9: ICP_Set retrieval ordering** — profiles returned ordered by createdAt ascending
    - **Validates: Requirements 3.1**

  - [ ]\* 3.5 Write unit tests for ICP Profile Service
    - Test isActive defaults to true on creation (Req 2.4)
    - Test founderId association on creation (Req 2.5)
    - Test profile update persists changes and updates timestamp (Req 3.2)
    - Test profile deletion retains associated leads (Req 3.6)
    - _Requirements: 2.4, 2.5, 3.2, 3.6_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement ICP Generator Service
  - [x] 5.1 Create `src/services/icpGeneratorService.ts`
    - Implement `generateICPSet(productDescription, founderId)` that calls OpenAI to produce 2–8 ICP_Profile records
    - Validate product description is non-empty/non-whitespace, return validation error otherwise
    - Parse and validate JSON response from OpenAI
    - Clamp pain points to 2–10 per profile, buying signals to 1–5
    - Ensure all targetRoles are distinct across profiles
    - Implement retry logic: retry once on invalid JSON or < 2 profiles
    - Return profiles without persisting (caller decides when to save)
    - On AI failure, throw descriptive error (preserve existing ICP_Set)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ]\* 5.2 Write property tests for generator output (Properties 1, 2, 3)
    - **Property 1: ICP_Set generation bounds and uniqueness** — non-empty product description produces 2–8 profiles with distinct targetRoles
    - **Validates: Requirements 1.1, 1.2**
    - **Property 2: Generated profile field completeness and bounds** — each profile has non-empty industry, painPoints 2–10, buyingSignals 1–5
    - **Validates: Requirements 1.3, 1.4, 1.5, 2.1**
    - **Property 3: Whitespace product description rejection** — whitespace-only strings produce validation error, zero profiles
    - **Validates: Requirements 1.6**

  - [ ]\* 5.3 Write unit tests for generator error handling
    - Test AI failure preserves existing ICP_Set (Req 1.7)
    - Test retry on invalid JSON response
    - Test retry on < 2 profiles returned
    - _Requirements: 1.7_

- [x] 6. Update Scoring Service with painPointRelevance
  - [x] 6.1 Add `calculateLeadScoreV2` function to `src/services/scoringService.ts`
    - Accept `ScoringInputV2` (lead + ICPProfile)
    - Compute `painPointRelevance` (0–20): analyze lead enrichment data for pain point keyword matches
    - Redistribute weights: icpMatch 0–25, roleRelevance 0–25, intentSignals 0–30, painPointRelevance 0–20
    - Return `ScoringOutput` with `ScoreBreakdownV2`
    - Handle null/missing enrichment data (painPointRelevance = 0)
    - Handle null icpProfileId by finding best-matching active profile
    - Preserve existing `calculateLeadScore` for backward compatibility
    - _Requirements: 6.1, 6.2, 6.4, 6.5_

  - [ ]\* 6.2 Write property test for painPointRelevance scoring bounds (Property 16)
    - **Property 16: painPointRelevance scoring bounds** — for any scoring input, painPointRelevance ∈ [0, 20]
    - **Validates: Requirements 6.2**

  - [ ]\* 6.3 Write unit tests for scoring service updates
    - Test scoring uses originating ICP_Profile (Req 6.1)
    - Test re-scoring uses originating profile (Req 6.4)
    - Test deleted profile fallback scoring (Req 6.5)
    - _Requirements: 6.1, 6.4, 6.5_

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update Query Generator for pain-point and buying-signal queries
  - [x] 8.1 Extend query generator in `src/services/discovery/queryGenerator.ts`
    - Add `AnnotatedQueryV2` interface extending AnnotatedQuery with icpProfileId, sourceType ('pain_point' | 'buying_signal' | 'base'), sourceText
    - Add `QueryGeneratorResultV2` interface
    - Implement `generateQueriesForProfile(profile, config?)` function
    - Generate at least 1 query per pain point (combining pain point + targetRole + industry)
    - Generate at least 1 query per buying signal
    - Generate base queries using existing behavior (targetRole, industry, geography)
    - Annotate each query with icpProfileId, sourceType, sourceText
    - Fall back to base queries if profile has no pain points
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]\* 8.2 Write property tests for query generation (Properties 13, 14, 15)
    - **Property 13: Pain-point query generation** — profile with P pain points produces ≥ P queries with sourceType 'pain_point'
    - **Validates: Requirements 5.1, 5.2**
    - **Property 14: Buying-signal query generation** — profile with B buying signals produces ≥ B queries with sourceType 'buying_signal'
    - **Validates: Requirements 5.3**
    - **Property 15: Query annotation completeness** — each pain_point/buying_signal query has icpProfileId and matching sourceText
    - **Validates: Requirements 5.4**

  - [ ]\* 8.3 Write unit tests for query generator fallback
    - Test fallback to base queries when no pain points (Req 5.5)
    - _Requirements: 5.5_

- [x] 9. Update Discovery Engine for multi-ICP discovery
  - [x] 9.1 Add `discoverLeadsMultiICP` function to `src/services/discovery/discoveryEngine.ts`
    - Accept array of ICPProfile and dailyCap
    - Distribute cap proportionally: floor(dailyCap / profiles.length), remainder round-robin
    - For each profile, generate queries via `generateQueriesForProfile`
    - Execute discovery across all queries, tag each prospect with originating icpProfileId
    - Deduplicate across profiles using existing `normalizeNameCompany`
    - For duplicates across profiles, score against each matching profile, keep highest-scoring association
    - Enforce global cap across all profiles
    - Return `MultiICPDiscoveryResult` with prospects and per-profile counts
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]\* 9.2 Write property tests for deduplication and cap enforcement (Properties 10, 11, 12)
    - **Property 10: Cross-ICP prospect deduplication** — after dedup, no two prospects share same normalized name+company
    - **Validates: Requirements 4.4**
    - **Property 11: Best-score ICP association** — duplicate prospect associated with highest-scoring profile
    - **Validates: Requirements 4.5**
    - **Property 12: Global daily discovery cap enforcement** — total discovered ≤ dailyCap
    - **Validates: Requirements 4.6**

- [x] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Create API endpoints for ICP profile management
  - [x] 11.1 Create `src/app/api/icp/profiles/route.ts` (GET list, POST create)
    - GET `/api/icp/profiles?founderId=<uuid>` — return ICPSet via `getICPSet`
    - POST `/api/icp/profiles` — validate and create a single profile via `createICPProfile`
    - _Requirements: 3.1, 3.5_

  - [x] 11.2 Create `src/app/api/icp/profiles/[id]/route.ts` (GET, PUT, DELETE)
    - GET `/api/icp/profiles/[id]` — return single profile
    - PUT `/api/icp/profiles/[id]` — validate and update profile
    - DELETE `/api/icp/profiles/[id]` — delete profile (leads retained)
    - _Requirements: 3.2, 3.6_

  - [x] 11.3 Create `src/app/api/icp/profiles/[id]/active/route.ts` (PATCH toggle)
    - PATCH `/api/icp/profiles/[id]/active` — toggle isActive via `setProfileActive`
    - _Requirements: 3.3, 3.4_

  - [x] 11.4 Update `src/app/api/icp/generate/route.ts` for multi-ICP generation
    - Update POST `/api/icp/generate` to call `generateICPSet` and return generated profiles for review (not persisted yet)
    - Preserve existing enriched ICP on AI failure (return 502 with existing set)
    - _Requirements: 1.1, 1.6, 1.7_

  - [x] 11.5 Create `src/app/api/icp/generate/confirm/route.ts` (POST confirm)
    - POST `/api/icp/generate/confirm` — accept generated profiles, call `replaceICPSet` to persist
    - Trigger re-scoring of all active leads against new ICP_Set
    - Retain all previously discovered leads
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 12. Update Pipeline Orchestrator and Enrichment Service
  - [x] 12.1 Update `executeDiscoveryStage` in `src/services/pipelineOrchestratorService.ts`
    - Fetch all active ICP profiles via `getActiveProfiles` instead of single ICP
    - Call `discoverLeadsMultiICP` instead of `discoverLeads`
    - Store `icp_profile_id` on each created lead
    - Use `calculateLeadScoreV2` for scoring with the originating ICPProfile
    - Skip discovery stage if no active profiles (log warning)
    - _Requirements: 4.1, 4.2, 4.3, 6.1, 6.3_

  - [x] 12.2 Update `discoverAndEnrichLeads` in `src/services/enrichmentService.ts`
    - Fetch all active ICP profiles
    - Call `discoverLeadsMultiICP` instead of `discoverLeads`
    - Pass originating icpProfileId through to lead creation and scoring
    - Use `calculateLeadScoreV2` for scoring
    - _Requirements: 4.1, 6.1, 6.3_

  - [x] 12.3 Update `src/services/leadService.ts` to support icp_profile_id
    - Add `icpProfileId` optional field to `CreateLeadInput`
    - Update `createLead` to insert `icp_profile_id` column
    - Update `mapRow` to include `icpProfileId` on Lead type
    - Update `updateLeadEnrichment` to accept ICPProfile for V2 scoring
    - _Requirements: 6.3_

- [ ] 13. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Build UI components for multi-ICP management
  - [x] 14.1 Create `src/components/ICPProfileCard.tsx`
    - Display a single ICP_Profile as a card: targetRole, industry, geography, painPoints list, buyingSignals list
    - Include active/inactive toggle control
    - Include inline editing capability for profile fields
    - Include delete button with confirmation
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 14.2 Create `src/components/ICPSetManager.tsx`
    - Display all ICP_Profile cards for the founder
    - Show total active profile count and leads discovered per profile
    - Include "Add Profile" button for manual profile creation
    - Include "Regenerate ICPs" button that triggers generation flow
    - _Requirements: 8.1, 8.5_

  - [x] 14.3 Update `src/components/ICPForm.tsx` for multi-ICP generation flow
    - Update product description submission to call updated `/api/icp/generate`
    - Display generated ICP_Set as preview cards for review before saving
    - Add "Confirm & Save" button that calls `/api/icp/generate/confirm`
    - Show pending state while founder reviews (existing set still active)
    - _Requirements: 8.4, 7.2, 7.3_

  - [x] 14.4 Wire ICPSetManager into the main page
    - Import and render `ICPSetManager` in `src/app/page.tsx` alongside or replacing the existing ICPForm
    - Ensure the generation flow and profile management are accessible from the main page
    - _Requirements: 8.1_

- [ ] 15. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Existing `ICP`, `ScoreBreakdown`, and `icpService.ts` are preserved for backward compatibility — new code uses `ICPProfile`, `ScoreBreakdownV2`, and `icpProfileService.ts`
- The old `icp` table is kept but deprecated; all new writes go to `icp_profile`
