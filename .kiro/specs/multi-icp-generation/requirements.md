# Requirements Document

## Introduction

The current system limits each founder to a single Ideal Customer Profile (ICP) with one target role, one industry, and one geography. In practice, a founder's product often appeals to multiple buyer personas — for example, an AI code review tool might be purchased by a VP of Engineering, a CTO, a Head of DevOps, or an Engineering Manager. Each persona has distinct pain points, buying signals, and relevance criteria.

This feature replaces the single-ICP model with a multi-ICP system. When a founder describes their product, the system generates multiple ICPs automatically. Each ICP carries its own pain points and buying signals. The discovery pipeline runs across all ICPs, and pain points are used during ingestion to find prospects discussing those specific problems — dramatically increasing lead volume and quality.

## Glossary

- **ICP_Profile**: A single Ideal Customer Profile record representing one buyer persona, with its own target role, industry, geography, pain points, and buying signals.
- **ICP_Set**: The complete collection of ICP_Profile records belonging to a single founder.
- **Founder**: The authenticated user who owns the product and ICP_Set.
- **Generator**: The AI-powered service that analyzes a product description and produces an ICP_Set.
- **Discovery_Pipeline**: The orchestrated process that generates search queries, discovers prospects, scores them, and ingests them as leads.
- **Query_Generator**: The service that creates search queries from an ICP_Profile for use by source adapters.
- **Scoring_Service**: The service that scores a discovered prospect against an ICP_Profile.
- **Pain_Point**: A specific problem or challenge that the founder's product solves for a given buyer persona.
- **Buying_Signal**: An observable indicator that a prospect is likely in-market for the founder's product (e.g., discussing a pain point publicly, hiring for related roles).

## Requirements

### Requirement 1: Multi-ICP Generation from Product Description

**User Story:** As a founder, I want the system to generate multiple ICPs from my product description, so that I can target all relevant buyer personas without manually creating each one.

#### Acceptance Criteria

1. WHEN a founder submits a product description to the Generator, THE Generator SHALL produce an ICP_Set containing between 2 and 8 ICP_Profile records.
2. THE Generator SHALL assign each ICP_Profile a distinct targetRole that represents a different buyer persona for the described product.
3. THE Generator SHALL populate each ICP_Profile with at least 2 and at most 10 Pain_Point entries specific to that persona.
4. THE Generator SHALL populate each ICP_Profile with at least 1 and at most 5 Buying_Signal entries specific to that persona.
5. THE Generator SHALL assign each ICP_Profile an industry, and optionally a companyStage and geography, inferred from the product description.
6. IF the Generator receives an empty or whitespace-only product description, THEN THE Generator SHALL return a descriptive validation error without creating any ICP_Profile records.
7. IF the AI service fails during generation, THEN THE Generator SHALL return an error response and preserve any previously saved ICP_Set for the Founder.

### Requirement 2: ICP_Profile Data Model

**User Story:** As a developer, I want each ICP to be stored as an independent record with its own pain points and buying signals, so that the system can operate on individual personas independently.

#### Acceptance Criteria

1. THE ICP_Profile SHALL contain the fields: id, founderId, targetRole, industry, companyStage (optional), geography (optional), painPoints (array of strings), buyingSignals (array of strings), customTags (optional array of strings), isActive (boolean), createdAt, and updatedAt.
2. THE ICP_Profile SHALL enforce that painPoints contains between 1 and 10 entries, each with a maximum length of 200 characters.
3. THE ICP_Profile SHALL enforce that buyingSignals contains between 1 and 5 entries, each with a maximum length of 200 characters.
4. THE ICP_Profile SHALL default isActive to true upon creation.
5. WHEN an ICP_Profile is created, THE system SHALL associate the ICP_Profile with the Founder via the founderId foreign key.

### Requirement 3: ICP_Set Management

**User Story:** As a founder, I want to view, edit, activate, and deactivate individual ICPs within my set, so that I can fine-tune which personas the system targets.

#### Acceptance Criteria

1. WHEN a founder requests their ICP_Set, THE system SHALL return all ICP_Profile records belonging to that Founder, ordered by creation date.
2. WHEN a founder updates an ICP_Profile, THE system SHALL persist the changes and update the updatedAt timestamp.
3. WHEN a founder deactivates an ICP_Profile, THE system SHALL set isActive to false and exclude that ICP_Profile from Discovery_Pipeline runs.
4. WHEN a founder activates a previously deactivated ICP_Profile, THE system SHALL set isActive to true and include that ICP_Profile in subsequent Discovery_Pipeline runs.
5. WHEN a founder manually adds a new ICP_Profile to the ICP_Set, THE system SHALL validate the required fields (targetRole, industry, at least 1 painPoint) before saving.
6. WHEN a founder deletes an ICP_Profile, THE system SHALL remove the ICP_Profile record and retain any leads previously discovered through that ICP_Profile.

### Requirement 4: Multi-ICP Discovery Pipeline

**User Story:** As a founder, I want the discovery pipeline to search across all my active ICPs, so that I discover leads matching every buyer persona.

#### Acceptance Criteria

1. WHEN the Discovery_Pipeline executes, THE Discovery_Pipeline SHALL retrieve all active ICP_Profile records in the Founder's ICP_Set.
2. THE Discovery_Pipeline SHALL generate search queries for each active ICP_Profile independently via the Query_Generator.
3. THE Discovery_Pipeline SHALL execute discovery across all generated queries, combining results from all ICP_Profile records.
4. THE Discovery_Pipeline SHALL deduplicate discovered prospects across ICP_Profile records using normalized name and company matching.
5. WHEN a prospect matches multiple ICP_Profile records, THE Discovery_Pipeline SHALL associate the lead with the ICP_Profile that produces the highest score from the Scoring_Service.
6. THE Discovery_Pipeline SHALL enforce the daily discovery cap across the entire ICP_Set, not per individual ICP_Profile.
7. THE Discovery_Pipeline SHALL distribute discovery effort proportionally across active ICP_Profile records within the daily cap.

### Requirement 5: Pain-Point-Aware Query Generation

**User Story:** As a founder, I want search queries to incorporate my ICP pain points, so that the system finds prospects who are actively discussing those problems.

#### Acceptance Criteria

1. WHEN the Query_Generator creates queries for an ICP_Profile, THE Query_Generator SHALL include at least one query per Pain_Point that targets prospects discussing that specific problem.
2. THE Query_Generator SHALL generate pain-point queries that combine the Pain_Point text with the ICP_Profile targetRole and industry to maximize relevance.
3. THE Query_Generator SHALL generate at least one query per Buying_Signal that targets observable indicators of purchase intent.
4. THE Query_Generator SHALL annotate each generated query with the originating ICP_Profile identifier and the Pain_Point or Buying_Signal it targets.
5. IF an ICP_Profile has no Pain_Point entries, THEN THE Query_Generator SHALL fall back to generating queries using only the targetRole, industry, and geography fields.

### Requirement 6: Multi-ICP Scoring

**User Story:** As a founder, I want each lead scored against the specific ICP it was discovered through, so that scores accurately reflect persona-level fit.

#### Acceptance Criteria

1. WHEN a lead is discovered through a specific ICP_Profile, THE Scoring_Service SHALL score the lead against that ICP_Profile.
2. THE Scoring_Service SHALL include a painPointRelevance component (0–20 points) that measures how closely the lead's context matches the ICP_Profile Pain_Point entries.
3. THE Scoring_Service SHALL store the originating ICP_Profile identifier on the lead record.
4. WHEN a lead is re-scored (e.g., after ICP changes), THE Scoring_Service SHALL re-score the lead against its originating ICP_Profile.
5. IF a lead's originating ICP_Profile has been deleted, THEN THE Scoring_Service SHALL score the lead against the ICP_Profile in the Founder's ICP_Set that produces the highest score.

### Requirement 7: Regeneration and ICP_Set Replacement

**User Story:** As a founder, I want to regenerate my ICPs from an updated product description, so that my personas stay current as my product evolves.

#### Acceptance Criteria

1. WHEN a founder submits a new product description for regeneration, THE Generator SHALL produce a new ICP_Set.
2. THE system SHALL replace the existing ICP_Set with the newly generated ICP_Set upon founder confirmation.
3. WHILE the founder has not confirmed the new ICP_Set, THE system SHALL continue using the existing ICP_Set for Discovery_Pipeline runs.
4. THE system SHALL retain all previously discovered leads after ICP_Set replacement.
5. WHEN the ICP_Set is replaced, THE system SHALL trigger re-scoring of all active leads against the new ICP_Set.

### Requirement 8: Multi-ICP UI Presentation

**User Story:** As a founder, I want to see all my ICPs displayed as individual cards with their pain points and buying signals, so that I can understand and manage each persona.

#### Acceptance Criteria

1. WHEN a founder views the ICP management page, THE system SHALL display each ICP_Profile as a distinct card showing targetRole, industry, geography, Pain_Point entries, and Buying_Signal entries.
2. THE system SHALL provide a toggle control on each ICP_Profile card to activate or deactivate that persona.
3. THE system SHALL provide inline editing capability for each ICP_Profile card.
4. WHEN the founder generates ICPs from a product description, THE system SHALL display the generated ICP_Set for review before saving.
5. THE system SHALL display the total count of active ICP_Profile records and the total count of leads discovered per ICP_Profile.
