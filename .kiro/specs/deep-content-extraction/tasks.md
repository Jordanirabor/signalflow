# Implementation Plan: Deep Content Extraction

## Overview

This plan upgrades the blog, podcast, and conference research adapters from storing shallow Serper snippets to fetching actual page content, extracting readable text with cheerio, and using OpenAI to produce structured ContentSummary objects. Each task builds incrementally — types first, then the two new services (Content Fetcher, Content Summarizer), then adapter updates, then personalization and message generation wiring. The existing TypeScript/Next.js codebase patterns are followed throughout.

## Tasks

- [x] 1. Add ContentSummary type and extend PersonalizationContext
  - [x] 1.1 Add `ContentSummary` interface to `src/types/index.ts`
    - Add `ContentSummary` interface with `synopsis` (string, max 300 chars), `keyPoints` (string[], 1–5), `notableQuotes` (string[], 0–3), `opinions` (string[], 0–3), `topics` (string[], 1–5), `sourceUrl` (string)
    - _Requirements: 2.1, 2.2, 2.3, 5.1_

  - [x] 1.2 Extend `PersonalizationContext` type in `src/types/index.ts`
    - Add optional `contentSummaries?: ContentSummary[]` field (parsed structured summaries)
    - Add optional `selectedContentDetail?: ContentSummary` field (most relevant for outreach)
    - _Requirements: 4.1, 4.4_

- [x] 2. Implement Content Fetcher Service
  - [x] 2.1 Create `src/services/contentFetcherService.ts` with page fetching and text extraction
    - Implement `fetchAndExtract(url)` that fetches a URL with a 10-second timeout via `AbortController`, checks `Content-Type` for HTML, and extracts readable text
    - Implement `extractReadableText(html)` using `cheerio` to strip `<script>`, `<style>`, `<nav>`, `<footer>`, `<aside>`, `<header>`, ad-related elements, then read from `<article>` or `<main>` or `<body>` in priority order
    - Implement `isAllowedByRobots(url)` with per-domain caching that fetches `/robots.txt` and checks disallow directives for `*` and `SignalFlow-Research-Bot`
    - Implement `truncateText(text, maxLength)` that truncates to 5000 characters
    - Set `User-Agent: SignalFlow-Research-Bot/1.0` header on all requests
    - Return `null` if extracted text is less than 100 characters
    - Skip non-HTML content types (PDF, images, binary)
    - Abort fetch if redirect chain exceeds 3 hops
    - On robots.txt fetch failure, assume allowed (permissive default)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]\* 2.2 Write property test: Text truncation enforces maximum length
    - **Property 3: Text truncation enforces maximum length**
    - **Validates: Requirements 1.3**

  - [ ]\* 2.3 Write property test: Minimum text length threshold
    - **Property 4: Minimum text length threshold**
    - **Validates: Requirements 6.2**

  - [ ]\* 2.4 Write property test: Robots.txt disallow rules are respected
    - **Property 10: Robots.txt disallow rules are respected**
    - **Validates: Requirements 6.4**

  - [ ]\* 2.5 Write unit tests for Content Fetcher Service
    - Test HTML boilerplate removal (nav, footer, aside, script, style stripped)
    - Test non-HTML content type skipped (PDF, image)
    - Test redirect chain > 3 hops aborted
    - Test User-Agent header set correctly
    - Test 10-second timeout configuration
    - Test extracted text < 100 chars returns null
    - _Requirements: 1.2, 1.4, 1.5, 6.1, 6.2, 6.3, 6.5_

- [x] 3. Implement Content Summarizer Service
  - [x] 3.1 Create `src/services/contentSummarizerService.ts` with AI-powered summarization
    - Implement `summarizeContent(text, sourceUrl)` that sends extracted text to OpenAI with a structured prompt requesting JSON output
    - Use `gpt-4o-mini` with `response_format: { type: 'json_object' }` for reliable structured output
    - Enforce a 15-second timeout via `AbortController`
    - Validate response structure: synopsis ≤ 300 chars, 1–5 keyPoints, 0–3 notableQuotes, 0–3 opinions, 1–5 topics, non-empty sourceUrl
    - Attempt to clamp out-of-bounds responses (truncate synopsis, trim lists) before rejecting
    - Return `null` on any failure (API error, timeout, invalid response)
    - Return `null` immediately for empty article text (no API call)
    - Implement `setOpenAIClient(client)` for test injection (same pattern as messageService)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]\* 3.2 Write property test: ContentSummary field constraints
    - **Property 2: ContentSummary field constraints**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]\* 3.3 Write property test: ContentSummary serialization round-trip
    - **Property 1: ContentSummary serialization round-trip**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [ ]\* 3.4 Write unit tests for Content Summarizer Service
    - Test AI failure returns null
    - Test 15-second timeout configuration
    - Test invalid AI response handling (missing fields, wrong types)
    - Test empty article text returns null immediately
    - Test clamping of out-of-bounds responses
    - _Requirements: 2.4, 2.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update Research Adapters to use Content Extraction Pipeline
  - [x] 5.1 Update `blogResearchAdapter` in `src/services/prospectResearcherService.ts`
    - After receiving Serper results, call `fetchAndExtract` for the top 3 URLs concurrently
    - For each successfully extracted text, call `summarizeContent`
    - Build `PartialResearchData` with JSON-serialized `ContentSummary` objects in `publishedContentSummaries`
    - Set `recentActivity` summary to `ContentSummary.synopsis` instead of Serper title + snippet
    - Populate `topicsOfInterest` with the union of all `ContentSummary.topics`, deduplicated
    - Fall back to original Serper title + snippet strings if all fetches/summarizations fail
    - _Requirements: 1.1, 1.4, 1.6, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 5.2 Update `podcastResearchAdapter` in `src/services/prospectResearcherService.ts`
    - Apply the same content extraction pipeline as the blog adapter
    - Call `fetchAndExtract` for top 3 Serper result URLs concurrently
    - Summarize extracted text and build enriched `PartialResearchData`
    - Fall back to original Serper snippets on complete failure
    - _Requirements: 1.1, 1.4, 1.6, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 5.3 Update `conferenceResearchAdapter` in `src/services/prospectResearcherService.ts`
    - Apply the same content extraction pipeline as the blog adapter
    - Call `fetchAndExtract` for top 3 Serper result URLs concurrently
    - Summarize extracted text and build enriched `PartialResearchData`
    - Fall back to original Serper snippets on complete failure
    - _Requirements: 1.1, 1.4, 1.6, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]\* 5.4 Write property test: ResearchActivity summary maps to ContentSummary synopsis
    - **Property 5: ResearchActivity summary maps to ContentSummary synopsis**
    - **Validates: Requirements 3.2**

  - [ ]\* 5.5 Write property test: Topics deduplication from ContentSummary objects
    - **Property 6: Topics deduplication from ContentSummary objects**
    - **Validates: Requirements 3.3**

  - [ ]\* 5.6 Write unit tests for updated Research Adapters
    - Test top 3 URLs fetched per adapter
    - Test single fetch failure continues with remaining URLs
    - Test all fetches fail falls back to Serper snippets
    - Test no summaries produced falls back to Serper snippets
    - Test ContentSummary JSON stored in publishedContentSummaries
    - _Requirements: 1.1, 1.4, 1.6, 3.1, 3.4, 3.5_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update Personalization Context Builder with ContentSummary parsing
  - [x] 7.1 Extend `src/services/personalizationContextBuilder.ts` with ContentSummary support
    - Implement `parseContentSummary(entry)` that attempts to parse a `publishedContentSummaries` string as JSON and validates it conforms to `ContentSummary` structure; returns `null` for legacy plain strings or invalid JSON
    - Implement `selectRelevantContent(summaries, icpPainPoints)` that selects the `ContentSummary` with the highest topic overlap with ICP pain points; returns the first summary if no overlap exists
    - Update `buildPersonalizationContext` to parse `publishedContentSummaries` entries, populate `contentSummaries` and `selectedContentDetail` on the returned `PersonalizationContext`
    - Maintain backward compatibility: legacy plain strings are treated as-is without errors
    - _Requirements: 4.3, 4.4, 4.5_

  - [ ]\* 7.2 Write property test: Content selection prefers highest topic overlap
    - **Property 8: Content selection prefers highest topic overlap with ICP pain points**
    - **Validates: Requirements 4.3**

  - [ ]\* 7.3 Write property test: Legacy plain string parsing returns null
    - **Property 9: Legacy plain string parsing returns null**
    - **Validates: Requirements 4.5**

  - [ ]\* 7.4 Write unit tests for Personalization Context Builder updates
    - Test legacy string backward compatibility (plain strings not parsed as ContentSummary)
    - Test mixed legacy and ContentSummary entries handled correctly
    - Test no ContentSummary objects results in empty contentSummaries array
    - _Requirements: 4.4, 4.5_

- [x] 8. Update Message Generator to include content details in prompt
  - [x] 8.1 Extend `buildEnhancedPrompt` in `src/services/messageService.ts` with ContentSummary data
    - Check if `PersonalizationContext` contains `selectedContentDetail` or `contentSummaries`
    - If available, include specific quotes, opinions, or key points from the `ContentSummary` in the prompt
    - Instruct the AI to reference at least one specific detail from the prospect's actual content
    - Prefer content details whose topics overlap with ICP pain points
    - Update `contentReferenced` in `PersonalizationMetadata` to include ContentSummary source URLs
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]\* 8.2 Write property test: Enhanced prompt includes content details when ContentSummary is available
    - **Property 7: Enhanced prompt includes content details when ContentSummary is available**
    - **Validates: Requirements 4.1**

  - [ ]\* 8.3 Write unit tests for updated Message Generator
    - Test prompt includes content details instruction when ContentSummary present
    - Test prompt falls back to existing behavior when no ContentSummary available
    - Test PersonalizationMetadata includes ContentSummary source URLs
    - _Requirements: 4.1, 4.2_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Install cheerio dependency
  - [x] 10.1 Add `cheerio` package to project dependencies
    - Run `npm install cheerio` and `npm install --save-dev @types/cheerio` (if needed)
    - Verify import works in `contentFetcherService.ts`
    - _Requirements: 1.2_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout, matching the existing codebase
- All new services follow the existing patterns in `src/services/`
- No database migration is needed — ContentSummary is stored as JSON strings in the existing `publishedContentSummaries: string[]` field
