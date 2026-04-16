# Requirements Document

## Introduction

ICP Project Segmentation introduces the concept of "projects" (also called campaigns) that group ICP profiles under a named entity with a stored product description. Currently, ICP profiles are flat — they belong to a founder with no grouping, the product description used during generation is discarded, the pipeline runs against all active profiles globally, and message generation pulls product context from a single global `pipeline_config`. This feature segments ICPs so founders can run multiple products or campaigns independently, with each project carrying its own product description that flows through discovery, scoring, messaging, and lead association.

## Glossary

- **Founder**: An authenticated user of the system who owns ICP profiles, leads, and pipeline runs.
- **ICP_Project**: A named grouping entity that associates a set of ICP profiles with a product description. Each project represents a distinct product or campaign.
- **ICP_Profile**: An individual ideal customer profile containing target role, industry, pain points, and buying signals. Belongs to exactly one ICP_Project.
- **Product_Description**: The free-text description of a product or service entered during ICP generation. Stored on the ICP_Project and used as context for message generation.
- **Pipeline**: The automated discovery-enrichment-outreach orchestration that finds leads matching ICP profiles.
- **Pipeline_Run**: A single execution of the pipeline scoped to a specific ICP_Project.
- **Lead**: A discovered prospect associated with an ICP_Profile and, transitively, an ICP_Project.
- **Message_Generator**: The service that produces personalized outreach messages using product context and lead data.
- **Project_Selector**: A UI control that allows the founder to choose which ICP_Project to operate against.

## Requirements

### Requirement 1: ICP Project Creation

**User Story:** As a founder, I want to create named ICP projects that group my ICP profiles together with a product description, so that I can manage multiple products or campaigns independently.

#### Acceptance Criteria

1. WHEN a founder provides a project name and product description, THE ICP_Project SHALL be created with a unique identifier, the provided name, the provided product description, and the founder's identifier.
2. THE ICP_Project SHALL require a non-empty name with a maximum length of 100 characters.
3. THE ICP_Project SHALL require a non-empty product description with a maximum length of 5000 characters.
4. THE ICP_Project SHALL store a created timestamp and an updated timestamp.
5. IF a founder attempts to create an ICP_Project with a name that duplicates an existing project name for the same founder, THEN THE ICP_Project SHALL reject the creation and return a descriptive error.
6. WHEN an ICP_Project is created, THE ICP_Project SHALL default to an active state.

### Requirement 2: ICP Project Management

**User Story:** As a founder, I want to edit, archive, and delete my ICP projects, so that I can keep my project list organized as my campaigns evolve.

#### Acceptance Criteria

1. WHEN a founder updates an ICP_Project name or product description, THE ICP_Project SHALL persist the changes and update the updated timestamp.
2. WHEN a founder archives an ICP_Project, THE ICP_Project SHALL set the project state to archived and exclude the project from pipeline execution and project selection defaults.
3. WHEN a founder deletes an ICP_Project, THE ICP_Project SHALL soft-delete the project and retain all associated leads and historical data.
4. THE ICP_Project SHALL prevent deletion of the last remaining active project for a founder, returning a descriptive error.
5. WHEN a founder lists ICP projects, THE ICP_Project SHALL return all non-deleted projects for the founder ordered by creation date descending, including active and archived projects.

### Requirement 3: ICP Profile Association with Projects

**User Story:** As a founder, I want my ICP profiles to belong to a specific project, so that each project has its own set of target customer profiles.

#### Acceptance Criteria

1. THE ICP_Profile SHALL belong to exactly one ICP_Project, referenced by a project identifier.
2. WHEN ICP profiles are generated via AI, THE ICP_Profile SHALL be associated with the ICP_Project specified during generation.
3. WHEN a founder manually creates an ICP_Profile, THE ICP_Profile SHALL require a project identifier and associate the profile with that project.
4. WHEN an ICP_Project is soft-deleted, THE ICP_Profile SHALL retain the project association for historical reference but exclude the profiles from active pipeline operations.
5. THE ICP_Profile SHALL support being moved from one ICP_Project to another by updating the project identifier.

### Requirement 4: Product Description Persistence

**User Story:** As a founder, I want the product description I enter during ICP generation to be saved with the project, so that it can be reused for message generation without re-entering it.

#### Acceptance Criteria

1. WHEN a founder generates ICPs and confirms the set, THE ICP_Project SHALL store the product description text that was used during generation.
2. WHEN a founder updates the product description on an ICP_Project, THE ICP_Project SHALL persist the new description and update the updated timestamp.
3. THE ICP_Project SHALL make the stored product description available to the Message_Generator when generating messages for leads within that project.
4. IF a founder generates ICPs for an existing project, THEN THE ICP_Project SHALL update the stored product description with the new description provided during regeneration.

### Requirement 5: Project-Scoped Pipeline Execution

**User Story:** As a founder, I want to run the pipeline against a specific ICP project, so that lead discovery is scoped to the profiles within that project.

#### Acceptance Criteria

1. WHEN a pipeline run is triggered, THE Pipeline SHALL accept an ICP_Project identifier specifying which project to run against.
2. WHILE a pipeline run is executing for a specific ICP_Project, THE Pipeline SHALL discover leads using only the active ICP profiles belonging to that project.
3. WHILE a pipeline run is executing for a specific ICP_Project, THE Pipeline SHALL apply the daily discovery cap per project rather than globally across all projects.
4. WHEN a lead is discovered during a project-scoped pipeline run, THE Lead SHALL be associated with the ICP_Project identifier in addition to the ICP_Profile identifier.
5. IF a pipeline run is triggered without specifying an ICP_Project identifier, THEN THE Pipeline SHALL return a validation error requiring project selection.

### Requirement 6: Project-Scoped Message Generation

**User Story:** As a founder, I want message generation to use the product description from the selected ICP project, so that outreach messages are contextually relevant to the specific product or campaign.

#### Acceptance Criteria

1. WHEN generating a message for a lead, THE Message_Generator SHALL use the product description from the lead's associated ICP_Project as the product context.
2. WHEN a founder manually triggers message generation, THE Message_Generator SHALL allow the founder to select which ICP_Project context to use.
3. IF a lead's associated ICP_Project has no product description, THEN THE Message_Generator SHALL fall back to the product context from the global pipeline configuration.
4. THE Message_Generator SHALL include the ICP_Project name in the message metadata for traceability.

### Requirement 7: Project-Scoped Lead Association

**User Story:** As a founder, I want leads to be associated with the ICP project that discovered them, so that I can view and manage leads per campaign.

#### Acceptance Criteria

1. THE Lead SHALL store a reference to the ICP_Project that originated the discovery.
2. WHEN listing leads, THE Lead SHALL support filtering by ICP_Project identifier.
3. WHEN a lead is displayed in the detail view, THE Lead SHALL show the name of the associated ICP_Project.
4. IF a lead's associated ICP_Project is soft-deleted, THEN THE Lead SHALL retain the project reference and display the project name with an archived indicator.
5. THE Lead SHALL support reassignment to a different ICP_Project by updating the project reference.

### Requirement 8: Project Selector UI

**User Story:** As a founder, I want a project selector in the UI, so that I can switch between projects when viewing leads, running the pipeline, or generating messages.

#### Acceptance Criteria

1. THE Project_Selector SHALL appear in the application layout and persist the selected project across page navigations within the same session.
2. WHEN a founder selects a project in the Project_Selector, THE Project_Selector SHALL update the active context and filter displayed leads, pipeline controls, and ICP profiles to the selected project.
3. THE Project_Selector SHALL display the project name and an indicator of the number of active ICP profiles within each project.
4. WHEN only one active ICP_Project exists, THE Project_Selector SHALL auto-select that project and still allow the founder to create new projects.
5. THE Project_Selector SHALL provide a quick-access option to create a new ICP_Project.

### Requirement 9: Migration of Existing Data

**User Story:** As a founder with existing ICP profiles and leads, I want my current data to be migrated into a default project, so that the system continues to work after the segmentation feature is introduced.

#### Acceptance Criteria

1. WHEN the migration runs, THE ICP_Project SHALL create a default project named "Default Project" for each founder who has existing ICP profiles.
2. WHEN the migration runs, THE ICP_Profile SHALL associate all existing profiles with the founder's default project.
3. WHEN the migration runs, THE Lead SHALL associate all existing leads with the founder's default project.
4. WHEN the migration runs, THE ICP_Project SHALL copy the product context from the founder's existing pipeline configuration into the default project's product description.
5. THE migration SHALL be idempotent, producing the same result when executed multiple times.
