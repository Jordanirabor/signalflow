# Tasks

## Task 1: Database Schema and Types

- [x] 1.1 Create migration file `migrations/add_icp_project.sql` with the `icp_project` table, `project_id` columns on `icp_profile`, `lead`, and `pipeline_run`, and all indexes
- [x] 1.2 Add `ICPProject` type to `src/types/index.ts` with fields: id, founderId, name, productDescription, isActive, isDeleted, deletedAt, createdAt, updatedAt
- [x] 1.3 Update `ICPProfile` type in `src/types/index.ts` to include optional `projectId` field
- [x] 1.4 Update `Lead` type in `src/types/index.ts` to include optional `projectId` field
- [x] 1.5 Update `PipelineRun` type in `src/types/index.ts` to include optional `projectId` field

## Task 2: ICP Project Service

- [x] 2.1 Create `src/services/icpProjectService.ts` with `createProject`, `getProjectById`, `listProjects`, `getActiveProjects` functions
- [x] 2.2 Add `updateProject`, `archiveProject`, `softDeleteProject`, `restoreProject` functions to the project service
- [x] 2.3 Add validation: name uniqueness per founder, name length (1-100), description length (1-5000), prevent deletion of last active project

## Task 3: ICP Profile Service Updates

- [-] 3.1 Update `createICPProfile` in `src/services/icpProfileService.ts` to accept and persist `projectId`
- [~] 3.2 Update `getICPSet` and `getActiveProfiles` to accept optional `projectId` filter parameter
- [~] 3.3 Update `replaceICPSet` to accept `projectId` and scope deletion/insertion to that project only
- [~] 3.4 Add `moveProfileToProject(profileId, targetProjectId)` function

## Task 4: Lead Service Updates

- [~] 4.1 Update `CreateLeadInput` and `createLead` in `src/services/leadService.ts` to accept and persist `projectId`
- [~] 4.2 Update `ListLeadsOptions` and `listLeads` to support optional `projectId` filter
- [~] 4.3 Update `LeadRow` mapper and `LEAD_COLUMNS` to include `project_id`
- [~] 4.4 Add `reassignLeadProject(leadId, targetProjectId)` function

## Task 5: Pipeline Orchestrator Updates

- [~] 5.1 Update `executePipelineRun` in `src/services/pipelineOrchestratorService.ts` to require `projectId` parameter
- [~] 5.2 Update `executeDiscoveryStage` to fetch only active profiles for the specified project using the updated `getActiveProfiles`
- [~] 5.3 Update daily discovery cap check to count leads discovered today for the specific project only
- [~] 5.4 Update lead creation within the pipeline to pass `projectId` to `createLead`

## Task 6: Message Service Updates

- [~] 6.1 Update `GenerateMessageInput` in `src/services/messageService.ts` to include optional `projectName` field
- [~] 6.2 Update `buildPrompt` and `buildEnhancedPrompt` to include project name in metadata when provided

## Task 7: Project API Routes

- [~] 7.1 Create `src/app/api/projects/route.ts` with GET (list projects) and POST (create project) handlers
- [~] 7.2 Create `src/app/api/projects/[id]/route.ts` with GET, PATCH (update), and DELETE (soft-delete) handlers
- [~] 7.3 Create `src/app/api/projects/[id]/archive/route.ts` with POST handler

## Task 8: Existing API Route Updates

- [~] 8.1 Update `src/app/api/icp/generate/route.ts` to accept `projectId` in request body
- [~] 8.2 Update `src/app/api/icp/generate/confirm/route.ts` to accept `projectId`, store product description on the project, and scope `replaceICPSet` to the project
- [~] 8.3 Update `src/app/api/icp/profiles/route.ts` GET to accept `projectId` query param and POST to require `projectId`
- [~] 8.4 Update `src/app/api/pipeline/run/route.ts` to require `projectId` in request body and pass it to `executePipelineRun`
- [~] 8.5 Update `src/app/api/leads/route.ts` GET to accept `projectId` query param for filtering
- [~] 8.6 Update `src/app/api/messages/generate/route.ts` to resolve product description from the lead's project, falling back to pipeline_config

## Task 9: Project Context and Selector UI

- [~] 9.1 Create `src/contexts/ProjectContext.tsx` with ProjectProvider, useProject hook, localStorage persistence of selected project ID
- [~] 9.2 Create `src/components/ProjectSelector.tsx` dropdown showing project name + active profile count, with "New Project" quick-action
- [~] 9.3 Update `src/app/(app)/layout.tsx` to wrap children with ProjectProvider and render ProjectSelector in the header

## Task 10: Existing UI Component Updates

- [~] 10.1 Update `src/components/ICPForm.tsx` to read selected project from context, pass `projectId` to generate/confirm APIs
- [~] 10.2 Update `src/components/ICPSetManager.tsx` to filter profiles by selected project and pass `projectId` when creating profiles
- [~] 10.3 Update `src/components/PipelineDashboard.tsx` to pass `projectId` to pipeline run trigger, disable "Run Now" when no project selected
- [~] 10.4 Update `src/components/LeadDetailView.tsx` to display associated project name with archived indicator when applicable
- [~] 10.5 Update `src/app/(app)/leads/page.tsx` to pass `projectId` filter from project context to leads API

## Task 11: Data Migration

- [~] 11.1 Create `migrations/backfill_default_projects.sql` that creates a "Default Project" per founder, backfills `project_id` on profiles/leads, copies product_context from pipeline_config
- [~] 11.2 Ensure migration is idempotent using `INSERT ... ON CONFLICT DO NOTHING` and conditional updates
