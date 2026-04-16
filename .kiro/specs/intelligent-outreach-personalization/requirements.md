# Requirements Document

## Introduction

The Intelligent Outreach Personalization feature transforms the existing outreach pipeline from a generic keyword-matching system into a deeply contextual, research-driven engine for booking high-quality 1:1 meetings. The feature enhances five interconnected stages: ICP generation (enriching it with product context, value propositions, and pain points), deep prospect research (automatically scraping blogs, social media, podcasts, and news), prospect-ICP correlation (matching prospects on meaningful dimensions rather than keywords), hyper-personalized cold outreach (generating messages that reference specific prospect content and pain points), and manual lead research (auto-researching manually added leads before message generation). The goal is to make every outreach message feel genuinely human and directly relevant to the recipient.

## Glossary

- **ICP_Generator**: The AI-powered service that produces an Ideal Customer Profile from founder inputs. Currently `POST /api/icp/generate` backed by `icpService.ts`.
- **Enriched_ICP**: An extended ICP data structure that includes product description, value proposition, pain points solved, competitor context, and ideal customer characteristics beyond the current `targetRole`, `industry`, `companyStage`, `geography`, and `customTags` fields.
- **Prospect_Researcher**: The service responsible for deep research on a prospect by aggregating content from blogs, LinkedIn posts, Twitter content, company news, podcast appearances, and conference talks.
- **Research_Profile**: The structured output of the Prospect_Researcher containing a prospect's topics of interest, challenges, recent activity, published content summaries, and sentiment indicators.
- **Discovery_Engine**: The existing multi-source lead discovery system (`discoveryEngine.ts`) that finds prospects matching the ICP.
- **Correlation_Engine**: The new subsystem that scores and ranks discovered prospects against the Enriched_ICP on semantic dimensions (role fit, industry alignment, pain point overlap) rather than keyword matching.
- **Correlation_Score**: A numeric score (0.0–1.0) representing how meaningfully a prospect matches the Enriched_ICP across role, industry, pain points, and buying signals.
- **Message_Generator**: The existing outreach message generation service (`messageService.ts`) that produces cold emails and DMs using OpenAI.
- **Personalization_Context**: The combined data package passed to the Message_Generator containing the Enriched_ICP, the Research_Profile, and the intersection analysis between founder offering and prospect needs.
- **Manual_Lead**: A lead added by the user with minimal information (name + company) via `POST /api/leads`.
- **Enrichment_Pipeline**: The existing multi-source enrichment system (`enrichmentPipeline.ts`) that gathers data from LinkedIn, Twitter, GitHub, company websites, news, and premium APIs.

## Requirements

### Requirement 1: Enriched ICP Generation

**User Story:** As a founder, I want the ICP to capture my product description, value proposition, specific pain points I solve, competitor context, and ideal customer characteristics, so that the system understands who to target and why.

#### Acceptance Criteria

1. WHEN a founder provides a product description to the ICP_Generator, THE ICP_Generator SHALL produce an Enriched_ICP that includes all of the following fields: product description summary, value proposition, pain points solved (as a list), competitor context, and ideal customer characteristics.
2. THE Enriched_ICP SHALL retain all existing ICP fields (targetRole, industry, companyStage, geography, customTags) in addition to the new enrichment fields.
3. WHEN a founder updates the product description, THE ICP_Generator SHALL regenerate the enrichment fields while preserving any manually edited ICP fields that the founder did not change.
4. THE ICP_Generator SHALL store the Enriched_ICP in the database so that downstream services (Discovery_Engine, Correlation_Engine, Message_Generator) can retrieve it without re-generation.
5. IF the AI generation fails, THEN THE ICP_Generator SHALL return a descriptive error message and preserve the previously saved Enriched_ICP unchanged.
6. WHEN an Enriched_ICP is generated, THE ICP_Generator SHALL produce a pain points list containing between 1 and 10 items, each no longer than 200 characters.

### Requirement 2: Deep Prospect Research

**User Story:** As a founder, I want the system to automatically research each prospect deeply when they are discovered or manually added, so that I have a comprehensive understanding of what they care about and what challenges they face.

#### Acceptance Criteria

1. WHEN a lead is created via the Discovery_Engine, THE Prospect_Researcher SHALL automatically initiate deep research on that prospect.
2. WHEN a lead is created manually via `POST /api/leads`, THE Prospect_Researcher SHALL automatically initiate deep research on that prospect.
3. THE Prospect_Researcher SHALL aggregate content from the following source categories: LinkedIn profile and posts, Twitter/X posts, personal or company blog posts, company news and press releases, podcast appearances, and conference talk references.
4. THE Prospect_Researcher SHALL produce a Research_Profile containing: topics of interest (list), current challenges (list), recent activity summaries (list with timestamps), published content summaries (list), and an overall sentiment indicator (positive, neutral, or negative).
5. THE Prospect_Researcher SHALL complete research for a single prospect within 120 seconds.
6. IF a research source is unavailable or returns no data, THEN THE Prospect_Researcher SHALL continue with remaining sources and record the unavailable source in the Research_Profile metadata.
7. WHILE the Prospect_Researcher is executing, THE system SHALL set the lead's enrichment status to "researching" and update it to "complete" or "partial" upon completion.
8. THE Prospect_Researcher SHALL store the Research_Profile in the database associated with the lead record so that the Message_Generator and Correlation_Engine can access it.

### Requirement 3: Prospect-ICP Correlation

**User Story:** As a founder, I want discovered prospects to be meaningfully correlated against my ICP based on role fit, industry alignment, and pain point overlap, so that I only spend time on leads who are genuinely likely to need my product.

#### Acceptance Criteria

1. WHEN the Discovery_Engine returns a set of prospects, THE Correlation_Engine SHALL compute a Correlation_Score for each prospect against the Enriched_ICP.
2. THE Correlation_Engine SHALL evaluate prospects on the following dimensions: role fit (how closely the prospect's role matches the ICP target role), industry alignment (whether the prospect's industry matches the ICP industry), pain point overlap (whether the prospect's challenges from the Research_Profile intersect with the ICP's pain points solved), and buying signal strength (recent activity indicating purchase intent or problem awareness).
3. THE Correlation_Engine SHALL weight the dimensions as follows: role fit 25%, industry alignment 25%, pain point overlap 35%, buying signal strength 15%.
4. THE Correlation_Engine SHALL produce a Correlation_Score between 0.0 and 1.0 for each prospect, where 1.0 represents a perfect match.
5. WHEN a prospect's Correlation_Score is below 0.3, THE Correlation_Engine SHALL flag the prospect as "low_correlation" and exclude the prospect from automated outreach sequences.
6. THE Correlation_Engine SHALL store the Correlation_Score and per-dimension breakdown alongside the lead record in the database.
7. WHEN the Enriched_ICP is updated, THE Correlation_Engine SHALL recalculate Correlation_Scores for all existing leads associated with that founder.

### Requirement 4: Hyper-Personalized Cold Outreach

**User Story:** As a founder, I want generated outreach messages to reference the prospect's specific pain points, recent content, and the intersection between my product and their needs, so that messages feel genuinely human and drive meeting bookings.

#### Acceptance Criteria

1. WHEN the Message_Generator generates a cold outreach message, THE Message_Generator SHALL construct a Personalization_Context containing: the Enriched_ICP (product description, value proposition, pain points solved), the prospect's Research_Profile (topics, challenges, recent activity), and an intersection analysis identifying which founder pain points map to which prospect challenges.
2. THE Message_Generator SHALL reference at least one specific piece of recent content or activity from the prospect's Research_Profile in the generated message.
3. THE Message_Generator SHALL address at least one specific pain point from the intersection analysis in the generated message.
4. THE Message_Generator SHALL avoid generic phrases including "I hope this finds you well", "I came across your profile", and "I wanted to reach out" in generated messages.
5. WHILE the prospect has a Research_Profile with recent activity newer than 30 days, THE Message_Generator SHALL prioritize referencing that recent activity over older content.
6. IF the prospect's Research_Profile contains no usable content, THEN THE Message_Generator SHALL fall back to generating a message using only the Enriched_ICP and the prospect's role and company context, and SHALL set the `limitedPersonalization` flag to true in the response.
7. THE Message_Generator SHALL enforce existing word limits: 150 words for cold DMs and 250 words for cold emails.
8. THE Message_Generator SHALL return the Personalization_Context metadata (sources used, pain points referenced, content referenced) alongside the generated message for transparency.

### Requirement 5: Manual Lead Auto-Research and Message Generation

**User Story:** As a founder, I want to add a lead with just a name and company, click "Generate Message", and have the system automatically research that person and generate a personalized message without requiring any additional input from me.

#### Acceptance Criteria

1. WHEN a user triggers message generation for a Manual_Lead that has no Research_Profile, THE system SHALL automatically trigger the Prospect_Researcher to perform deep research on that lead before generating the message.
2. THE system SHALL complete the combined research-and-generate workflow (research + message generation) within 180 seconds.
3. WHILE the research phase is executing, THE system SHALL provide a progress indicator to the user showing the current research stage (e.g., "Researching LinkedIn...", "Analyzing content...", "Generating message...").
4. WHEN research completes, THE system SHALL immediately proceed to message generation using the newly created Research_Profile without requiring user intervention.
5. IF the research phase fails entirely (all sources unavailable), THEN THE system SHALL generate a message using only the Enriched_ICP and lead's basic information (name, role, company) and SHALL notify the user that the message has limited personalization.
6. THE system SHALL persist the Research_Profile from the auto-research step so that subsequent message generations for the same lead do not repeat the research.
7. WHEN a user triggers message generation for a Manual_Lead that already has a Research_Profile older than 7 days, THE system SHALL offer to refresh the research before generating the message.

### Requirement 6: Research Profile Serialization

**User Story:** As a developer, I want Research_Profiles to be serialized and deserialized consistently, so that data integrity is maintained across storage and retrieval operations.

#### Acceptance Criteria

1. THE system SHALL serialize Research_Profile objects to JSON for database storage.
2. THE system SHALL deserialize stored JSON back into Research_Profile objects with all fields intact.
3. FOR ALL valid Research_Profile objects, serializing then deserializing SHALL produce an equivalent object (round-trip property).
4. WHEN a Research_Profile contains empty lists for topics, challenges, or activity summaries, THE system SHALL preserve those empty lists through serialization rather than converting them to null.

### Requirement 7: Correlation Score Computation Integrity

**User Story:** As a developer, I want the Correlation_Score computation to be deterministic and bounded, so that scoring is reliable and predictable.

#### Acceptance Criteria

1. THE Correlation_Engine SHALL produce a Correlation_Score that is always between 0.0 and 1.0 inclusive, regardless of input values.
2. THE Correlation_Engine SHALL produce identical Correlation_Scores when given identical inputs (deterministic computation).
3. WHEN all dimension scores are zero, THE Correlation_Engine SHALL produce a Correlation_Score of 0.0.
4. WHEN all dimension scores are at maximum, THE Correlation_Engine SHALL produce a Correlation_Score of 1.0.
5. THE sum of dimension weights (role fit, industry alignment, pain point overlap, buying signal strength) SHALL equal 1.0.
