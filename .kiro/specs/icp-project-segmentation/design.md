# Design Document

## Overview

This design introduces an `icp_project` table that groups ICP profiles under a named project with a stored product description. All existing services (pipeline orchestrator, message generator, lead service, ICP profile service) are updated to be project-aware. A migration script associates existing data with a default project per founder. The UI gains a project selector in the app layout that scopes all views to the selected project.

## Architecture

### Database Schema Changes

#### New Table: `icp_project`

```sql
CREATE TABLE icp_project (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id UUID NOT NULL REFERENCES founder(id),
  name VARCHAR(100) NOT NULL,
  product_description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(founder_id, name)
);

CREATE INDEX idx_icp_project_founder ON icp_project(founder_id) WHERE is_deleted = false;
```

#### Modified Table: `icp_profile`

Add a foreign key column:

```sql
ALTER TABLE icp_profile ADD COLUMN project_id UUID REFERENCES icp_project(id) ON DELETE SET NULL;
CREATE INDEX idx_icp_profile_project ON icp_profile(project_id);
```

#### Modified Table: `lead`

Add a foreign key column:

```sql
ALTER TABLE lead ADD COLUMN project_id UUID REFERENCES icp_project(id) ON DELETE SET NULL;
CREATE INDEX idx_lead_project ON lead(project_id) WHERE is_deleted = false;
```

#### Modified Table: `pipeline_run`

Add a foreign key column to scope runs:

```sql
ALTER TABLE pipeline_run ADD COLUMN project_id UUID REFERENCES icp_project(id);
```

### Migration Script

A SQL migration creates a default project for each founder with existing ICP profiles, copies `pipeline_config.product_context` as the product description, and backfills `project_id` on `icp_profile`, `lead`, and `pipeline_run` rows. The migration is idempotent — it uses `INSERT ... ON CONFLICT DO NOTHING` and conditional updates.

### Service Layer Changes

#### New: `src/services/icpProjectService.ts`

CRUD service for `icp_project`:

- `createProject(founderId, name, productDescription)` → validates name uniqueness, length constraints, creates record
- `updateProject(id, { name?, productDescription? })` → partial update with timestamp bump
- `archiveProject(id)` → sets `is_active = false`
- `softDeleteProject(id)` → sets `is_deleted = true`, checks it's not the last active project
- `restoreProject(id)` → sets `is_deleted = false, is_active = true`
- `getProjectById(id)` → single project fetch
- `listProjects(founderId)` → returns non-deleted projects ordered by `created_at DESC`
- `getActiveProjects(founderId)` → returns active, non-deleted projects

#### Modified: `src/services/icpProfileService.ts`

- `createICPProfile` accepts `projectId` parameter
- `getActiveProfiles(founderId)` gains optional `projectId` filter
- `replaceICPSet` accepts `projectId` and scopes replacement to that project only (not all founder profiles)
- `getICPSet(founderId)` gains optional `projectId` filter
- New: `moveProfileToProject(profileId, targetProjectId)` updates the `project_id` column

#### Modified: `src/services/leadService.ts`

- `CreateLeadInput` gains `projectId?: string`
- `createLead` persists `project_id`
- `listLeads` gains optional `projectId` filter in `ListLeadsOptions`
- `getLeadById` returns `projectId` in the mapped Lead object
- New: `reassignLeadProject(leadId, targetProjectId)` updates the `project_id` column

#### Modified: `src/services/pipelineOrchestratorService.ts`

- `executePipelineRun(founderId, projectId)` requires `projectId`
- `executeDiscoveryStage` fetches only active profiles for the given project
- Daily discovery cap is checked per project (counting leads discovered today for that project)
- Created leads receive the `project_id`

#### Modified: `src/services/messageService.ts`

- `GenerateMessageInput` gains optional `projectName?: string`
- Message metadata includes `projectName` when provided

#### Modified: `src/services/pipelineConfigService.ts`

- No structural changes. The global `pipeline_config.product_context` serves as fallback when a project has no product description.

### API Route Changes

#### New: `src/app/api/projects/route.ts`

- `GET` — list projects for the authenticated founder
- `POST` — create a new project (body: `{ name, productDescription }`)

#### New: `src/app/api/projects/[id]/route.ts`

- `GET` — get project by ID
- `PATCH` — update project name/description
- `DELETE` — soft-delete project

#### New: `src/app/api/projects/[id]/archive/route.ts`

- `POST` — archive a project

#### Modified: `src/app/api/icp/generate/route.ts`

- Request body gains `projectId` field
- Passes `projectId` through to generation flow

#### Modified: `src/app/api/icp/generate/confirm/route.ts`

- Request body gains `projectId` field
- Creates/updates the project's product description
- Associates confirmed profiles with the project
- `replaceICPSet` scoped to the project

#### Modified: `src/app/api/icp/profiles/route.ts`

- `GET` accepts `projectId` query parameter to filter profiles
- `POST` requires `projectId` in body

#### Modified: `src/app/api/pipeline/run/route.ts`

- Request body requires `projectId`
- Returns validation error if missing

#### Modified: `src/app/api/leads/route.ts`

- `GET` accepts `projectId` query parameter to filter leads

#### Modified: `src/app/api/messages/generate/route.ts`

- When `projectId` is provided (or derived from lead's project), fetches the project's product description and uses it as `productContext`
- Falls back to `pipeline_config.product_context` if project has no description

### UI Component Changes

#### New: `src/components/ProjectSelector.tsx`

A dropdown/combobox in the app layout that:

- Fetches projects via `GET /api/projects`
- Stores selected project ID in React context (and localStorage for persistence)
- Shows project name + active profile count badge
- Includes a "New Project" quick-action
- Auto-selects when only one project exists

#### New: `src/contexts/ProjectContext.tsx`

React context provider that:

- Holds `selectedProjectId` state
- Persists to localStorage
- Provides `selectedProject` object and `setSelectedProject` setter
- Wraps the app layout

#### Modified: `src/app/(app)/layout.tsx`

- Wraps children with `ProjectProvider`
- Renders `ProjectSelector` in the header/sidebar

#### Modified: `src/components/ICPForm.tsx`

- Reads selected project from context
- Passes `projectId` to generate and confirm API calls
- Shows project name in the generation card header

#### Modified: `src/components/ICPSetManager.tsx`

- Filters displayed profiles by selected project
- Passes `projectId` when creating new profiles

#### Modified: `src/components/PipelineDashboard.tsx`

- Reads selected project from context
- Passes `projectId` to pipeline run trigger
- Disables "Run Now" if no project is selected

#### Modified: `src/components/LeadDetailView.tsx`

- Displays the associated project name
- Shows "(archived)" indicator if the project is soft-deleted

#### Modified: `src/app/(app)/leads/page.tsx`

- Passes `projectId` filter to leads API

## Correctness Properties

### Property 1: Project name uniqueness per founder (Req 1.5)

For all valid project names N and founder F, creating two projects with the same name N for founder F results in exactly one success and one rejection error.

### Property 2: Profile-project association invariant (Req 3.1, 5.4, 7.1)

For all ICP profiles created within a project-scoped operation, the profile's `project_id` is non-null and matches the specified project. For all leads discovered during a project-scoped pipeline run, the lead's `project_id` matches the pipeline run's `project_id`.

### Property 3: Project-scoped discovery isolation (Req 5.2)

For all pipeline runs scoped to project P, every discovered lead's `icp_profile_id` references a profile whose `project_id` equals P. No lead is discovered using a profile from a different project.

### Property 4: Product description round-trip (Req 4.1, 4.2)

For all valid product descriptions D, creating or updating a project with description D then reading the project returns description D unchanged.

### Property 5: Project-scoped lead filtering (Req 7.2)

For all founders with leads across multiple projects, filtering leads by project P returns a subset where every lead's `project_id` equals P, and the count is less than or equal to the total lead count.

### Property 6: Migration idempotency (Req 9.5)

Running the migration script N times (N >= 1) produces the same database state: exactly one default project per founder, all orphaned profiles and leads associated with that project, and the product description matching the pipeline config's product context.

### Property 7: Soft-delete preserves data (Req 2.3, 7.4)

For all projects that are soft-deleted, the project's leads remain queryable, the project name remains accessible on lead detail views, and the lead count does not decrease.

### Property 8: Last active project protection (Req 2.4)

For all founders with exactly one active non-deleted project, attempting to delete or archive that project results in a rejection error, and the project remains active.

### Property 9: Project-scoped message context (Req 6.1)

For all message generation requests where the lead belongs to project P with product description D, the `productContext` passed to the LLM prompt contains D.

## File Changes

### New Files

- `src/services/icpProjectService.ts` — CRUD service for icp_project
- `src/app/api/projects/route.ts` — list/create projects API
- `src/app/api/projects/[id]/route.ts` — get/update/delete project API
- `src/app/api/projects/[id]/archive/route.ts` — archive project API
- `src/contexts/ProjectContext.tsx` — React context for selected project
- `src/components/ProjectSelector.tsx` — project selector dropdown component
- `migrations/add_icp_project.sql` — schema migration (new table, alter existing tables)
- `migrations/backfill_default_projects.sql` — data migration script

### Modified Files

- `src/types/index.ts` — add ICPProject type, update ICPProfile/Lead/PipelineRun types
- `src/services/icpProfileService.ts` — add projectId support to CRUD operations
- `src/services/leadService.ts` — add projectId to CreateLeadInput, listLeads filter
- `src/services/pipelineOrchestratorService.ts` — require projectId, scope discovery
- `src/services/messageService.ts` — add projectName to input/metadata
- `src/app/api/icp/generate/route.ts` — accept projectId
- `src/app/api/icp/generate/confirm/route.ts` — accept projectId, scope replaceICPSet
- `src/app/api/icp/profiles/route.ts` — filter by projectId
- `src/app/api/pipeline/run/route.ts` — require projectId
- `src/app/api/leads/route.ts` — filter by projectId
- `src/app/api/messages/generate/route.ts` — resolve product description from project
- `src/app/(app)/layout.tsx` — add ProjectProvider and ProjectSelector
- `src/components/ICPForm.tsx` — use selected project context
- `src/components/ICPSetManager.tsx` — filter by selected project
- `src/components/PipelineDashboard.tsx` — pass projectId to pipeline run
- `src/components/LeadDetailView.tsx` — display project name
- `src/app/(app)/leads/page.tsx` — pass projectId filter
