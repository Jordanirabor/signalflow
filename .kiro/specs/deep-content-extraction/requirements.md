# Requirements Document

## Introduction

The Deep Content Extraction feature upgrades the existing research pipeline so that the blog, podcast, and conference research adapters go beyond storing Serper search result titles and snippets. Instead, the system fetches the actual page content for top search results, uses AI to extract and summarize key points, opinions, quotes, and topics from each article, and stores richer content summaries in the Research Profile. The message generation prompt is then updated to reference specific content details (quotes, opinions, specific topics discussed) so that outreach messages feel genuinely informed about what the prospect has actually written or said.

The existing research adapters (`blogResearchAdapter`, `podcastResearchAdapter`, `conferenceResearchAdapter`) in `src/services/prospectResearcherService.ts` use the Serper API to find articles but only store `title: snippet` strings. The Research Profile stores `publishedContentSummaries` as `string[]` and `recentActivity` as `ResearchActivity[]`. The message generator in `src/services/messageService.ts` uses the `PersonalizationContext` built by `src/services/personalizationContextBuilder.ts`.

## Glossary

- **Content_Fetcher**: A new service responsible for fetching the full HTML content of a web page given its URL and extracting the readable text body.
- **Content_Summarizer**: A new AI-powered service that takes raw article text and produces a structured content summary containing key points, opinions, quotes, and topics.
- **Content_Summary**: A structured object representing the AI-extracted summary of a single article or page, containing key points, notable quotes, opinions expressed, and topics discussed.
- **Research_Adapter**: An existing source adapter (blog, podcast, or conference) in the Prospect Researcher that searches for prospect content via the Serper API.
- **Research_Profile**: The structured output of the Prospect Researcher containing a prospect's topics of interest, challenges, recent activity, published content summaries, and sentiment indicators. Stored as JSONB on the lead record.
- **Message_Generator**: The existing outreach message generation service (`messageService.ts`) that produces cold emails and DMs using OpenAI.
- **Personalization_Context_Builder**: The existing service (`personalizationContextBuilder.ts`) that assembles the full context for message generation by computing intersection analysis between ICP pain points and prospect challenges.
- **Serper_Result**: A single organic search result returned by the Serper API, containing a title, snippet, and link URL.

## Requirements

### Requirement 1: Fetch Full Page Content for Top Search Results

**User Story:** As a founder, I want the research pipeline to fetch the actual content of articles found during prospect research, so that the system has real substance to work with instead of just search result snippets.

#### Acceptance Criteria

1. WHEN a Research_Adapter receives Serper_Results for a prospect, THE Content_Fetcher SHALL fetch the full page content for the top 3 Serper_Results by rank order.
2. THE Content_Fetcher SHALL extract the readable text body from the fetched HTML, removing navigation, ads, footers, and boilerplate elements.
3. THE Content_Fetcher SHALL enforce a maximum extracted text length of 5000 characters per page to limit downstream processing costs.
4. IF a page fetch fails (network error, timeout, or HTTP error status), THEN THE Content_Fetcher SHALL skip that result and continue processing remaining results without failing the entire adapter.
5. THE Content_Fetcher SHALL enforce a per-page fetch timeout of 10 seconds to prevent slow pages from blocking the research pipeline.
6. IF all page fetches for a given Research_Adapter fail, THEN THE Research_Adapter SHALL fall back to storing the original Serper_Result title and snippet as the content summary.

### Requirement 2: AI-Powered Content Summarization

**User Story:** As a founder, I want each fetched article to be summarized by AI to extract key points, opinions, quotes, and topics, so that the system captures the substance of what the prospect has written or said.

#### Acceptance Criteria

1. WHEN the Content_Fetcher successfully retrieves page text, THE Content_Summarizer SHALL produce a Content_Summary containing: key points (list of strings), notable quotes (list of strings), opinions expressed (list of strings), and topics discussed (list of strings).
2. THE Content_Summarizer SHALL produce a Content_Summary with between 1 and 5 key points, between 0 and 3 notable quotes, between 0 and 3 opinions, and between 1 and 5 topics.
3. THE Content_Summarizer SHALL produce a single-paragraph plain-text synopsis of no more than 300 characters for each summarized article.
4. IF the AI summarization call fails, THEN THE Content_Summarizer SHALL fall back to using the original Serper_Result title and snippet as the content summary.
5. THE Content_Summarizer SHALL complete summarization of a single article within 15 seconds.

### Requirement 3: Store Rich Content Summaries in Research Profile

**User Story:** As a founder, I want the Research Profile to contain detailed content summaries instead of just titles and snippets, so that downstream services have rich data to personalize outreach.

#### Acceptance Criteria

1. THE Research_Adapter SHALL store Content_Summary objects in the Research_Profile `publishedContentSummaries` field as structured JSON strings, each containing the synopsis, key points, quotes, opinions, topics, and source URL.
2. THE Research_Adapter SHALL store enriched `ResearchActivity` entries in the Research_Profile `recentActivity` field where the `summary` field contains the Content_Summary synopsis instead of the Serper_Result title and snippet.
3. THE Research_Adapter SHALL populate the `topicsOfInterest` field in the Research_Profile with the union of all topics extracted from Content_Summary objects, deduplicated.
4. WHEN a Research_Profile is updated with Content_Summary data, THE system SHALL preserve backward compatibility by ensuring `publishedContentSummaries` remains a `string[]` (each entry is a JSON-serialized Content_Summary).
5. IF no Content_Summary objects are produced for a Research_Adapter (all fetches and summarizations failed), THEN THE Research_Adapter SHALL store the original Serper_Result title and snippet strings in `publishedContentSummaries` as before.

### Requirement 4: Update Message Generation to Reference Specific Content Details

**User Story:** As a founder, I want generated outreach messages to reference specific quotes, opinions, and topics from the prospect's content, so that messages feel genuinely informed and engaging.

#### Acceptance Criteria

1. WHEN the Message_Generator builds an enhanced prompt and the Research_Profile contains Content_Summary data, THE Message_Generator SHALL include specific quotes, opinions, or key points from the Content_Summary in the prompt context.
2. THE Message_Generator SHALL instruct the AI to reference at least one specific detail (a quote, opinion, or key point) from the prospect's actual content in the generated message.
3. WHEN multiple Content_Summary objects are available, THE Message_Generator SHALL select the most relevant content details by preferring entries whose topics overlap with the Enriched ICP pain points.
4. THE Personalization_Context_Builder SHALL parse Content_Summary JSON strings from `publishedContentSummaries` and expose the structured data for prompt construction.
5. IF the `publishedContentSummaries` entries are plain strings (legacy format without Content_Summary structure), THEN THE Personalization_Context_Builder SHALL treat them as-is without attempting to parse structured data, maintaining backward compatibility.

### Requirement 5: Content Summary Serialization Round-Trip

**User Story:** As a developer, I want Content_Summary objects to be serialized and deserialized consistently, so that data integrity is maintained when storing and retrieving rich content data.

#### Acceptance Criteria

1. THE system SHALL serialize Content_Summary objects to JSON strings for storage in the `publishedContentSummaries` array.
2. THE system SHALL deserialize stored JSON strings back into Content_Summary objects with all fields intact.
3. FOR ALL valid Content_Summary objects, serializing to JSON then deserializing SHALL produce an equivalent object (round-trip property).
4. WHEN a Content_Summary contains empty lists for quotes, opinions, or topics, THE system SHALL preserve those empty lists through serialization rather than converting them to null.

### Requirement 6: Content Extraction Resilience

**User Story:** As a developer, I want the content extraction pipeline to handle edge cases gracefully, so that the research pipeline remains reliable even when encountering problematic web pages.

#### Acceptance Criteria

1. WHEN the Content_Fetcher encounters a page that returns non-HTML content (PDF, image, binary), THE Content_Fetcher SHALL skip that result and record it as a failed fetch.
2. WHEN the Content_Fetcher encounters a page with less than 100 characters of extracted text, THE Content_Fetcher SHALL treat the extraction as insufficient and fall back to the Serper_Result title and snippet.
3. WHEN the Content_Fetcher encounters a redirect chain longer than 3 hops, THE Content_Fetcher SHALL abort the fetch for that URL and record it as a failed fetch.
4. THE Content_Fetcher SHALL respect robots.txt directives and skip pages that disallow fetching.
5. THE Content_Fetcher SHALL set a User-Agent header identifying the request as an automated research tool.
