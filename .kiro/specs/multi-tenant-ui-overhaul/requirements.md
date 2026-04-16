# Requirements Document

## Introduction

The SignalFlow GTM Engine currently hardcodes a single founder identity (`FOUNDER_ID = '00000000-0000-0000-0000-000000000001'`) across 15 client components and passes it to API routes via query parameters and request bodies. With ConsentKeys OIDC authentication now in place and sessions storing the authenticated user's `founderId`, the application must transition to session-driven, per-user data scoping so each signed-in founder sees only their own data.

Simultaneously, the UI is built with ~2800 lines of custom CSS, inconsistent styling, and a flat tab-bar navigation that does not scale. The application needs a production-ready UI/UX overhaul using shadcn/ui on top of Tailwind CSS, replacing the tab bar with a sidebar-based app shell, adding proper loading/empty/error states, and ensuring responsive design for desktop and tablet viewports.

## Glossary

- **App_Shell**: The persistent layout wrapper containing the Sidebar, Header, and main content area that frames every authenticated page.
- **Sidebar**: A vertical navigation panel on the left side of the App_Shell that replaces the current horizontal tab bar.
- **Header**: A horizontal bar at the top of the App_Shell displaying the application name, the signed-in user's display name, and a sign-out control.
- **Session**: The encrypted httpOnly cookie (`sf_session`) containing the authenticated user's `sub`, `email`, `name`, `founderId`, and tokens, managed by the `getSession` / `setSession` functions in `src/lib/auth.ts`.
- **Session_Hook**: A client-side React hook (`useSession`) that fetches session data from `GET /api/auth/session` and provides `founderId`, `name`, `email`, and loading/error states to components.
- **Founder_ID**: A UUID that uniquely identifies a founder (user) in the `founder` database table. Previously hardcoded as a constant; now derived from the authenticated Session.
- **Component**: A React client component in `src/components/` that renders part of the application UI.
- **API_Route**: A Next.js server-side route handler in `src/app/api/` that processes HTTP requests and interacts with the database.
- **shadcn_ui**: A collection of accessible, composable UI components built on Radix UI primitives and styled with Tailwind CSS.
- **Tailwind_CSS**: A utility-first CSS framework used for styling all UI elements.
- **Loading_State**: A visual indicator (skeleton or spinner) displayed while data is being fetched.
- **Empty_State**: A placeholder message or illustration displayed when a data set contains zero records.
- **Error_State**: A styled alert or message displayed when a data fetch or action fails.
- **Login_Page**: The `/login` route where unauthenticated users are directed to sign in via ConsentKeys OIDC.

## Requirements

### Requirement 1: Session-Based Founder Identity Hook

**User Story:** As a developer, I want a centralized React hook that provides the authenticated user's session data, so that all components can access the `founderId` without importing a hardcoded constant.

#### Acceptance Criteria

1. THE Session_Hook SHALL fetch session data from `GET /api/auth/session` on mount and expose `founderId`, `name`, `email`, `isLoading`, and `error` fields.
2. WHILE the Session_Hook is loading, THE Session_Hook SHALL set `isLoading` to `true` and `founderId` to `null`.
3. WHEN `GET /api/auth/session` returns a 401 status, THE Session_Hook SHALL redirect the browser to the Login_Page.
4. WHEN `GET /api/auth/session` returns a successful response, THE Session_Hook SHALL populate `founderId`, `name`, and `email` from the response payload.
5. IF `GET /api/auth/session` fails due to a network error, THEN THE Session_Hook SHALL set `error` to a descriptive message and set `isLoading` to `false`.

### Requirement 2: Remove Hardcoded FOUNDER_ID From All Client Components

**User Story:** As a developer, I want all client components to receive the `founderId` from the session instead of importing a hardcoded constant, so that each user's data is properly scoped.

#### Acceptance Criteria

1. THE Application SHALL contain zero imports of the `FOUNDER_ID` constant from `@/lib/constants` in any client Component.
2. WHEN a Component requires a `founderId`, THE Component SHALL obtain the value from the Session_Hook or from a prop passed by a parent Component.
3. WHEN the Session_Hook is still loading, THE Component SHALL display a Loading_State instead of making API calls with an undefined `founderId`.
4. THE following Components SHALL use the session-derived `founderId` for all API calls: ICPForm, ICPSetManager, DashboardSummary, LeadListView, CRMPipelineView, PipelineDashboard, PipelineConfiguration, ConversationView, ManualReviewQueue, CalendarWeekView, CalendarIntegrationSetup, EmailIntegrationSetup, ThrottleConfig, OutreachTracker, InsightForm, MessageEditor.

### Requirement 3: Server-Side Session Enforcement on API Routes

**User Story:** As a product owner, I want API routes to derive the `founderId` from the server-side session rather than trusting client-supplied parameters, so that users cannot access another user's data.

#### Acceptance Criteria

1. WHEN an API_Route receives a request that requires a `founderId`, THE API_Route SHALL extract the `founderId` from the server-side Session using `getSession()`.
2. IF the Session is absent or expired on an API_Route that requires authentication, THEN THE API_Route SHALL return a 401 HTTP status with a JSON body containing `{ "error": "Unauthorized" }`.
3. THE API_Route SHALL ignore any client-supplied `founderId` in query parameters or request bodies and use only the session-derived value.
4. WHEN a user queries leads, ICP profiles, pipeline data, outreach records, dashboard summaries, or any founder-scoped resource, THE API_Route SHALL filter results to only records belonging to the session-derived `founderId`.

### Requirement 4: Install and Configure shadcn/ui with Tailwind CSS

**User Story:** As a developer, I want shadcn/ui and Tailwind CSS properly installed and configured in the project, so that all UI components can use a consistent, accessible design system.

#### Acceptance Criteria

1. THE Application SHALL include `tailwindcss` and its required PostCSS plugins as dependencies.
2. THE Application SHALL include a `tailwind.config.ts` (or equivalent) that scans all files in `src/` for Tailwind class usage.
3. THE Application SHALL include a `components.json` configuration file for shadcn/ui at the project root.
4. THE Application SHALL include a `src/lib/utils.ts` file exporting a `cn()` utility function that merges Tailwind classes using `clsx` and `tailwind-merge`.
5. THE Application SHALL include shadcn/ui CSS variables for theming defined in the global stylesheet.

### Requirement 5: Replace Custom CSS with shadcn/ui Components

**User Story:** As a user, I want a clean, modern, and consistent interface, so that the application feels professional and is easy to use.

#### Acceptance Criteria

1. THE Application SHALL replace all custom-styled buttons with the shadcn_ui Button component.
2. THE Application SHALL replace all custom-styled form inputs, selects, and textareas with the corresponding shadcn_ui Input, Select, and Textarea components.
3. THE Application SHALL replace all custom-styled cards and panels with the shadcn_ui Card component (Card, CardHeader, CardTitle, CardContent, CardFooter).
4. THE Application SHALL replace all custom-styled tables with the shadcn_ui Table component (Table, TableHeader, TableRow, TableHead, TableBody, TableCell).
5. THE Application SHALL replace all custom-styled dialogs and modals with the shadcn_ui Dialog component.
6. THE Application SHALL replace all custom-styled tab groups with the shadcn_ui Tabs component (Tabs, TabsList, TabsTrigger, TabsContent).
7. THE Application SHALL replace all custom-styled status indicators with the shadcn_ui Badge component.
8. THE Application SHALL replace all custom toast/notification elements with the shadcn_ui Toast component (or Sonner integration).
9. WHEN the migration is complete, THE Application SHALL remove the custom CSS rules from `globals.css` that are superseded by Tailwind and shadcn_ui styling.

### Requirement 6: Sidebar-Based App Shell Layout

**User Story:** As a user, I want a sidebar navigation layout instead of the current tab bar, so that I can navigate between sections efficiently and see where I am in the application.

#### Acceptance Criteria

1. THE App_Shell SHALL render a vertical Sidebar on the left side containing navigation links for: Dashboard, Leads, Pipeline, Messages, Outreach, Insights, ICP, Throttle, and Autopilot.
2. THE Sidebar SHALL visually highlight the currently active navigation item.
3. THE App_Shell SHALL render a Header at the top displaying the text "SignalFlow" and the signed-in user's display name.
4. THE Header SHALL include a sign-out control that navigates to `/api/auth/logout` when activated.
5. WHEN the viewport width is below 768px, THE Sidebar SHALL collapse into a toggleable mobile menu.
6. THE App_Shell SHALL render the main content area to the right of the Sidebar, occupying the remaining viewport width.

### Requirement 7: Authenticated User Display

**User Story:** As a user, I want to see my name and have a sign-out option visible at all times, so that I know which account I am using and can log out easily.

#### Acceptance Criteria

1. THE Header SHALL display the signed-in user's name obtained from the Session_Hook.
2. WHEN the Session_Hook does not provide a name, THE Header SHALL fall back to displaying the user's email address.
3. WHEN the user activates the sign-out control, THE Application SHALL navigate to `/api/auth/logout` to clear the session and redirect to the Login_Page.

### Requirement 8: Login Page Redesign with shadcn/ui

**User Story:** As a user, I want the login page to look professional and consistent with the rest of the application, so that my first impression of the product is positive.

#### Acceptance Criteria

1. THE Login_Page SHALL use shadcn_ui Card, Button, and typography components for layout and styling.
2. THE Login_Page SHALL display the application name "SignalFlow" and the tagline "GTM Intelligence Engine".
3. THE Login_Page SHALL display a prominent "Sign in with ConsentKeys" Button that links to `/api/auth/login`.
4. WHEN an error query parameter is present in the URL, THE Login_Page SHALL display the decoded error message using a shadcn_ui styled alert.
5. THE Login_Page SHALL be centered vertically and horizontally on the viewport.

### Requirement 9: Loading, Empty, and Error States

**User Story:** As a user, I want clear visual feedback when data is loading, when there is no data, or when something goes wrong, so that I understand the application's status at all times.

#### Acceptance Criteria

1. WHILE data is being fetched, THE Component SHALL display a Loading_State using a skeleton placeholder or spinner consistent with shadcn_ui patterns.
2. WHEN a data fetch returns an empty result set, THE Component SHALL display an Empty_State with a descriptive message and, where applicable, a call-to-action to create the first record.
3. IF a data fetch fails, THEN THE Component SHALL display an Error_State with the error message and a retry action.
4. THE Loading_State, Empty_State, and Error_State SHALL use consistent styling derived from shadcn_ui components across all Components.

### Requirement 10: Responsive Design

**User Story:** As a user, I want the application to work well on both desktop and tablet screens, so that I can use it on different devices.

#### Acceptance Criteria

1. THE Application SHALL render correctly on viewports with widths of 1024px and above (desktop).
2. THE Application SHALL render correctly on viewports with widths between 768px and 1023px (tablet).
3. WHEN the viewport width is below 768px, THE Sidebar SHALL collapse and be accessible via a toggle button in the Header.
4. THE Application SHALL use Tailwind_CSS responsive utility classes to adapt layout, spacing, and typography across breakpoints.
