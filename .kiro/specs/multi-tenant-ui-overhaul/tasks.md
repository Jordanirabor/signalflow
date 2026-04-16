# Implementation Plan: Multi-Tenant UI Overhaul

## Overview

Migrate the SignalFlow GTM Engine from a hardcoded single-tenant UI with custom CSS to a session-driven multi-tenant application using shadcn/ui + Tailwind CSS with sidebar navigation. Work proceeds in phases: foundation setup, session infrastructure, app shell, API route hardening, component refactoring, login redesign, and cleanup.

## Tasks

- [x] 1. Install Tailwind CSS and shadcn/ui foundation
  - [x] 1.1 Install Tailwind CSS, PostCSS, and configure `tailwind.config.ts` to scan all `src/` files
    - Add `tailwindcss`, `postcss`, `autoprefixer` as dependencies
    - Create `tailwind.config.ts` with content paths covering `src/**/*.{ts,tsx}`
    - Update `globals.css` with Tailwind directives (`@tailwind base; @tailwind components; @tailwind utilities;`)
    - _Requirements: 4.1, 4.2_

  - [x] 1.2 Initialize shadcn/ui and install required components
    - Create `components.json` at project root with `new-york` style, `zinc` base color, and aliases for `@/components/ui`, `@/lib/utils`, `@/hooks`
    - Install `clsx` and `tailwind-merge` dependencies
    - Create `src/lib/utils.ts` exporting the `cn()` utility function
    - Add shadcn/ui CSS variables for theming to `globals.css`
    - Install shadcn/ui components: Button, Card, Input, Textarea, Select, Table, Tabs, Badge, Dialog, Alert, Skeleton, Separator, Sheet, DropdownMenu, Sonner (Toaster)
    - _Requirements: 4.3, 4.4, 4.5_

- [x] 2. Checkpoint — Verify Tailwind and shadcn/ui foundation
  - Ensure `tailwind.config.ts` exists and is valid
  - Ensure `components.json` exists at project root
  - Ensure `src/lib/utils.ts` exports `cn()`
  - Ensure `globals.css` contains shadcn/ui CSS variables and Tailwind directives
  - Ensure all shadcn/ui components are installed under `src/components/ui/`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Create the `useSession` hook
  - [x] 3.1 Implement `useSession` hook in `src/hooks/useSession.ts`
    - Fetch `GET /api/auth/session` on mount
    - Expose `{ session: { founderId, name, email } | null, isLoading: boolean, error: string | null }`
    - Redirect to `/login` on 401 response
    - Set descriptive `error` on network failure
    - Implement module-level promise caching for fetch deduplication across components
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]\* 3.2 Write property test for `useSession` session mapping (Property 1)
    - **Property 1: Session hook faithfully maps API response**
    - Generate random valid session payloads with `founderId` (UUID), `name` (string|null), `email` (string|null)
    - Verify the hook populates its returned `session` object with exactly those values without transformation
    - Min 100 iterations
    - **Validates: Requirements 1.4**

  - [ ]\* 3.3 Write unit tests for `useSession` hook
    - Test loading state (`isLoading: true` initially)
    - Test successful response mapping
    - Test 401 redirect to `/login`
    - Test network error sets `error` and `isLoading: false`
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 4. Create App Shell layout with Sidebar and Header
  - [x] 4.1 Create the Sidebar component at `src/components/Sidebar.tsx`
    - Render vertical nav with 9 items: Dashboard, Leads, Pipeline, Messages, Outreach, Insights, ICP, Throttle, Autopilot
    - Each item links to its corresponding route (`/dashboard`, `/leads`, etc.)
    - Use `usePathname()` to highlight the active nav item
    - Use shadcn/ui Button (variant ghost) and Separator for styling
    - Accept `isOpen` and `onToggle` props for mobile responsiveness
    - On viewports < 768px, render inside a shadcn/ui Sheet (slide-out mobile menu)
    - _Requirements: 6.1, 6.2, 6.5, 10.3_

  - [x] 4.2 Create the Header component at `src/components/Header.tsx`
    - Display "SignalFlow" branding text
    - Display signed-in user's name from `useSession()`, falling back to email
    - Include sign-out link navigating to `/api/auth/logout`
    - Include mobile menu toggle button (hamburger icon) visible below 768px
    - Use shadcn/ui Button and DropdownMenu for user menu
    - _Requirements: 6.3, 6.4, 7.1, 7.2, 7.3, 10.3_

  - [x] 4.3 Create the App Shell layout at `src/app/(app)/layout.tsx`
    - Create the `(app)` route group directory
    - Compose Sidebar + Header + `<main>` content area
    - Sidebar on the left, main content occupying remaining width
    - Manage sidebar open/close state for mobile toggle
    - Add Sonner `<Toaster />` for toast notifications
    - _Requirements: 6.6, 10.1, 10.2, 10.4_

  - [x] 4.4 Create stub page routes under `(app)/` for each section
    - Create `src/app/(app)/dashboard/page.tsx`, `leads/page.tsx`, `pipeline/page.tsx`, `messages/page.tsx`, `outreach/page.tsx`, `insights/page.tsx`, `icp/page.tsx`, `throttle/page.tsx`, `autopilot/page.tsx`
    - Each page imports and renders its corresponding existing component(s)
    - Wire up the root `/` route to redirect to `/dashboard`
    - _Requirements: 6.1_

  - [ ]\* 4.5 Write unit tests for Sidebar and Header
    - Verify all 9 nav items render with correct labels and hrefs
    - Verify active item highlighting based on pathname
    - Verify Header displays user name, falls back to email
    - Verify sign-out link points to `/api/auth/logout`
    - _Requirements: 6.1, 6.2, 7.1, 7.2, 7.3_

- [x] 5. Checkpoint — Verify App Shell and navigation
  - Ensure App Shell layout renders Sidebar, Header, and main content area
  - Ensure all 9 route pages exist and render without errors
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Refactor API routes to use server-side session
  - [x] 6.1 Refactor Dashboard and Leads API routes
    - `GET /api/dashboard/summary` — call `getSession()`, return 401 if null, use `session.founderId` for DB queries, ignore client-supplied founderId
    - `GET /api/leads` — same pattern
    - `GET /api/leads/[id]` — same pattern
    - `POST /api/leads/discover` — same pattern
    - `POST /api/leads/recalculate` — same pattern
    - `POST /api/leads/cleanup` — same pattern
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 6.2 Refactor ICP API routes
    - `GET /api/icp` — call `getSession()`, return 401 if null, use `session.founderId`
    - `GET /api/icp/profiles` — same pattern
    - `POST /api/icp/profiles` — same pattern
    - `POST /api/icp/generate` — same pattern
    - `POST /api/icp/generate/confirm` — same pattern
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 6.3 Refactor CRM and Pipeline API routes
    - `GET /api/crm/pipeline` — call `getSession()`, return 401 if null, use `session.founderId`
    - `PATCH /api/crm/[leadId]/status` — same pattern
    - `GET /api/pipeline/status` — same pattern
    - `GET /api/pipeline/metrics` — same pattern
    - `GET /api/pipeline/config` — same pattern
    - `POST /api/pipeline/run` — same pattern
    - `GET /api/pipeline/runs` — same pattern
    - `GET /api/pipeline/conversations` — same pattern
    - `GET /api/pipeline/review` — same pattern
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 6.4 Refactor Calendar, Email, Throttle, Outreach, Insights, and Messages API routes
    - `GET /api/pipeline/calendar/week` — call `getSession()`, return 401 if null, use `session.founderId`
    - `GET /api/pipeline/calendar/status` — same pattern
    - `GET /api/pipeline/calendar/slots` — same pattern
    - `GET /api/pipeline/email/status` — same pattern
    - `GET /api/throttle/config`, `PUT /api/throttle/config`, `GET /api/throttle/status` — same pattern
    - `GET /api/outreach`, `GET /api/outreach/stale`, `POST /api/outreach/[leadId]` — same pattern
    - `GET /api/insights/[leadId]`, `GET /api/insights/aggregate` — same pattern
    - `POST /api/messages/generate` — same pattern
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]\* 6.5 Write property test for API route session enforcement (Property 3)
    - **Property 3: API routes use session-derived founderId, ignoring client-supplied values**
    - Generate random (session founderId, attacker founderId) pairs
    - Call API routes with attacker founderId in query params/body while authenticated as session founderId
    - Verify response data is scoped to session founderId only
    - Min 100 iterations
    - **Validates: Requirements 3.1, 3.3, 3.4**

  - [ ]\* 6.6 Write property test for unauthenticated API requests (Property 4)
    - **Property 4: Unauthenticated API requests receive 401**
    - For each authenticated API route, call without a valid session cookie
    - Verify 401 response with `{ "error": "Unauthorized" }` body
    - Min 100 iterations
    - **Validates: Requirements 3.2**

- [x] 7. Checkpoint — Verify API route session enforcement
  - Ensure all refactored API routes call `getSession()` and return 401 when session is absent
  - Ensure no API route reads `founderId` from query params or request body
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Refactor client components to use `useSession` and shadcn/ui
  - [x] 8.1 Refactor Dashboard and Lead components
    - `DashboardSummary` — replace `FOUNDER_ID` import with `useSession()`, add skeleton loading state, replace custom CSS with shadcn/ui Card + Skeleton, remove `founderId` from fetch calls
    - `LeadListView` — same pattern, replace custom table with shadcn/ui Table, add empty state
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.3, 5.4, 9.1, 9.2, 9.3_

  - [x] 8.2 Refactor ICP components
    - `ICPForm` — replace `FOUNDER_ID` import with `useSession()`, add skeleton loading state, replace custom form elements with shadcn/ui Input/Textarea/Button/Select, replace confirm dialog with shadcn/ui Dialog
    - `ICPSetManager` — same pattern, replace custom cards with shadcn/ui Card, add empty state
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3, 5.5, 9.1, 9.2, 9.3_

  - [x] 8.3 Refactor CRM and Pipeline components
    - `CRMPipelineView` — replace `FOUNDER_ID` import with `useSession()`, add skeleton loading state, replace custom styling with shadcn/ui Card/Badge/Table
    - `PipelineDashboard` — same pattern
    - `PipelineConfiguration` — same pattern, replace custom form elements with shadcn/ui components
    - `ConversationView` — same pattern
    - `ManualReviewQueue` — same pattern
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.3, 5.6, 5.7, 9.1, 9.2, 9.3_

  - [x] 8.4 Refactor Calendar, Email, Throttle, Outreach, Insights, and Message components
    - `CalendarWeekView` — replace `FOUNDER_ID` import with `useSession()`, add skeleton loading state, replace custom styling with shadcn/ui components
    - `CalendarIntegrationSetup` — same pattern
    - `EmailIntegrationSetup` — same pattern
    - `ThrottleConfig` — same pattern, replace custom form elements with shadcn/ui Input/Button
    - `OutreachTracker` — same pattern, replace custom table with shadcn/ui Table/Badge
    - `InsightForm` — same pattern
    - `MessageEditor` — same pattern, replace custom textarea with shadcn/ui Textarea/Button
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3, 5.7, 5.8, 9.1, 9.2, 9.3_

  - [ ]\* 8.5 Write property test for client components not sending founderId (Property 2)
    - **Property 2: Client components never send founderId in API requests**
    - Generate random session states and render components
    - Intercept outgoing fetch calls and verify none include `founderId` as a query parameter or body field
    - Min 100 iterations
    - **Validates: Requirements 2.4**

  - [ ]\* 8.6 Write unit tests for component loading, empty, and error states
    - Test that each refactored component shows Skeleton when `useSession` is loading
    - Test that components display empty state when data fetch returns empty results
    - Test that components display error alert with retry button on fetch failure
    - _Requirements: 2.3, 9.1, 9.2, 9.3, 9.4_

- [x] 9. Checkpoint — Verify component refactoring
  - Ensure zero imports of `FOUNDER_ID` from `@/lib/constants` in any client component
  - Ensure all components use `useSession()` for session data
  - Ensure all components render shadcn/ui primitives instead of custom-styled elements
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Redesign the Login page with shadcn/ui
  - [x] 10.1 Rewrite `src/app/login/page.tsx` using shadcn/ui components
    - Use shadcn/ui Card (CardHeader, CardTitle, CardDescription, CardContent, CardFooter) for layout
    - Display "SignalFlow" as CardTitle and "GTM Intelligence Engine" as CardDescription
    - Render "Sign in with ConsentKeys" as a shadcn/ui Button linking to `/api/auth/login`
    - Display error from `?error=` query param using shadcn/ui Alert with `variant="destructive"`
    - Center the card vertically and horizontally using Tailwind (`flex min-h-screen items-center justify-center`)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]\* 10.2 Write unit tests for Login page
    - Verify Card renders with "SignalFlow" title and tagline
    - Verify Button links to `/api/auth/login`
    - Verify error alert displays when `?error=` param is present
    - Verify page is centered on viewport
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 11. Clean up old CSS and constants
  - [x] 11.1 Remove superseded custom CSS from `globals.css`
    - Remove all custom CSS rules that have been replaced by Tailwind and shadcn/ui styling (`.app-container`, `.app-header`, `.app-nav`, `.tab`, `.login-page`, `.login-card`, `.action-btn`, `.metric-card`, `.lead-table`, `.status-badge`, `.pipeline-card`, `.icp-preview-card`, `.toast`, `.form-feedback`, etc.)
    - Keep only Tailwind directives, shadcn/ui CSS variables, and any truly global resets
    - _Requirements: 5.9_

  - [x] 11.2 Remove or deprecate the `FOUNDER_ID` constant
    - Remove the `FOUNDER_ID` export from `src/lib/constants.ts` (or delete the file if it only contains that constant)
    - Verify no remaining imports of `FOUNDER_ID` across the codebase
    - _Requirements: 2.1_

  - [x] 11.3 Remove the old monolithic `src/app/page.tsx` tab-based layout
    - Replace `src/app/page.tsx` with a redirect to `/dashboard` (or remove it if the `(app)` route group handles the root)
    - Remove unused tab-related types and state management code
    - _Requirements: 6.1_

- [x] 12. Final checkpoint — Full verification
  - Ensure zero imports of `FOUNDER_ID` in the entire codebase
  - Ensure all API routes enforce server-side session
  - Ensure all components use `useSession()` and shadcn/ui primitives
  - Ensure App Shell with Sidebar and Header renders correctly
  - Ensure Login page uses shadcn/ui components
  - Ensure `globals.css` contains no superseded custom CSS
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation between major phases
- Property tests validate universal correctness properties from the design document
- The existing auth infrastructure (OIDC, middleware, encrypted cookies) is unchanged — this is purely a refactoring effort
