# SignalFlow — Complete Feature Catalog & Billing Tiers

## What Is SignalFlow?

SignalFlow is an autonomous go-to-market engine for founders. It discovers high-fit prospects across the open web, researches them deeply using AI, writes hyper-personalized outreach, sends it from your inbox, handles replies, and books meetings on your calendar — all on autopilot. You describe your offering and your ideal customer. SignalFlow does the rest.

It is not a lead database. It is not a template tool. It is a system that replaces the entire outbound workflow: prospecting, research, copywriting, sending, follow-up, and scheduling.

---

## Feature Categories

### 1. ICP Definition & Multi-Project Management

| Feature                          | Description                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-Generated ICP Profiles        | Describe your offering in plain text. SignalFlow generates detailed buyer personas with target roles, industries, company stages, geographies, pain points, and buying signals. |
| Multi-ICP Support                | Generate and manage multiple distinct buyer personas per project. Each profile can be toggled active/inactive independently.                                                 |
| Multi-Project Architecture       | Run separate campaigns for different products, services, or offerings. Each project has its own ICP profiles, leads, strategy, and pipeline scope.                           |
| AI-Inferred Project Naming       | Projects are automatically named by AI based on your offering description. You can override with a custom name at any time.                                                  |
| Per-Project Strategy             | Toggle outreach strategy between global (one strategy for everything) and per-project (unique value propositions and pain points per offering).                              |
| ICP Regeneration with Re-Scoring | Replace your ICP set at any time. All existing leads are automatically re-scored against the new profiles and reassigned to the best-matching persona.                       |

### 2. Lead Discovery & Enrichment

| Feature                            | Description                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proprietary Multi-Source Discovery | Finds prospects across Google Search, LinkedIn, GitHub, Twitter, Crunchbase, company websites, and news sources — no purchased lead lists.                                                                                             |
| AI-Powered Search Query Generation | Uses OpenAI to generate targeted, niche-specific search queries from your ICP, including LinkedIn-targeted, general web, and directory queries.                                                                                        |
| AI-Powered Result Parsing          | Replaces fragile regex with LLM interpretation of search results. Extracts structured lead data (name, role, company, LinkedIn URL) with confidence scoring.                                                                           |
| Retry Discovery with Feedback      | When a discovery run returns few results, the system generates refined queries using feedback about what was missing and runs a second pass.                                                                                           |
| Waterfall Email Discovery          | Tries multiple methods in sequence: web search for email patterns → pattern inference from known company emails → Hunter API → SMTP verification. Stops at the first verified result.                                                  |
| Domain Discovery via Web Search    | Finds actual company domains through web search instead of guessing "companyname.com". Validates MX records before use.                                                                                                                |
| SMTP Email Verification            | Verifies email addresses directly via SMTP without external APIs. Records verification method and result.                                                                                                                              |
| AI Research Agent                  | Deep prospect profiling across 3+ source types (LinkedIn, company website, news/blogs, Twitter, GitHub). Synthesizes findings into structured research profiles with topics of interest, challenges, recent activity, and pain points. |
| Deep Content Extraction            | Fetches actual page content from articles found during research (not just snippets). AI extracts key points, notable quotes, opinions, and topics from each article.                                                                   |
| Enrichment Data                    | LinkedIn bio, recent posts, company info, email (verified), confidence scores, data sources, LinkedIn URL, company domain.                                                                                                             |
| Enrichment Retry & Recovery        | Failed enrichments are automatically retried up to 3 times with exponential backoff. Partial data is preserved and merged on retry.                                                                                                    |
| Apollo Integration (Optional)      | Apollo.io available as a supplementary discovery and enrichment source. Can be enabled/disabled independently.                                                                                                                         |
| Lead Search & Autofill             | Type a name in the add-lead form to search Apollo's people database. Select a match to auto-populate all fields. Manual entry always available as fallback.                                                                            |

### 3. Lead Scoring & Management

| Feature                   | Description                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-Dimensional Scoring | Leads scored 1–100 across ICP match, role relevance, intent signals, and pain point relevance. Full score breakdown visible per lead.                         |
| Correlation Scoring       | Prospect-ICP correlation engine computes role fit, industry alignment, pain point overlap, and buying signal strength (0.0–1.0).                              |
| Lead Grouping by Project  | Filter leads by project first, then by ICP profile within that project. Default view scoped to the currently selected project.                                |
| Per-Lead Steering Context | Add custom instructions per lead (up to 1000 chars) that get injected into message generation prompts for that specific person.                               |
| Duplicate Detection       | Automatic duplicate checking by name + company on lead creation. Returns existing lead ID on conflict.                                                        |
| Soft Delete & Restore     | Leads are soft-deleted with a 30-day restoration window.                                                                                                      |
| Manual Lead Entry         | Add leads manually with name, role, company, industry, geography, and email. Auto-scored against active ICP on creation.                                      |
| CRM Pipeline              | Five-stage pipeline: New → Contacted → Replied → Booked → Closed. Status changes recorded with reasons and timestamps. Backward transitions require a reason. |

### 4. AI Message Generation & Personalization

| Feature                        | Description                                                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-Powered Message Generation  | Generates cold emails and cold DMs using OpenAI (GPT-4o). Messages follow a proven cold outreach structure with hook, offer, connection, and soft ask.                                                     |
| Five Tone Presets              | Warm, Professional, Casual, Direct, and Bold. Each tone has a distinct directive injected into the LLM system prompt.                                                                                      |
| Research-Based Personalization | Messages reference specific details from the prospect's research profile: quotes, opinions, recent activity, published content, and pain points.                                                           |
| Content-Aware Hooks            | When deep content extraction data is available, the message hook references specific quotes, opinions, or key points from the prospect's actual published content.                                         |
| Intersection Analysis          | Automatically identifies overlap between your ICP's pain points and the prospect's known challenges. Uses the best match to connect your offer to their world.                                             |
| On-Demand Research Fallback    | If a lead lacks sufficient personalization data, the system triggers real-time AI research before generating the message. Falls back gracefully to role/company-specific messaging if research also fails. |
| Global Steering Context        | Set instructions (up to 2000 chars) that apply to every generated message (e.g., "always mention our free trial", "avoid discussing pricing").                                                             |
| Per-Lead Steering Context      | Override or supplement global steering with lead-specific instructions that take precedence.                                                                                                               |
| Call Notes Integration         | Pain points, objections, and sentiment from recorded call notes are injected into the message generation prompt for returning prospects.                                                                   |
| Word Limit Enforcement         | DMs capped at 150 words, emails at 250 words. Enforced post-generation with intelligent truncation.                                                                                                        |
| Banned Phrase Detection        | System prompt explicitly bans overused outreach phrases ("I hope this finds you well", "synergy", "circle back", etc.).                                                                                    |
| Personalization Metadata       | Every generated message includes metadata: sources used, pain points referenced, content referenced, intersection score, and whether on-demand research was triggered.                                     |
| Sender Name & Signature        | Messages include the founder's configured sending name and email signature.                                                                                                                                |

### 5. Automated Pipeline & Orchestration

| Feature                             | Description                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Autonomous Pipeline Orchestrator    | Background engine runs on a configurable cron schedule (default: every 60 minutes during business hours). Processes discovery, outreach, follow-up, inbox monitoring, and booking stages sequentially. |
| Business Hours Enforcement          | Pipeline only runs during configured business hours and business days. Configurable timezone.                                                                                                          |
| Automated Prospect Discovery        | Each run discovers new prospects matching the active ICP, scores them, enriches them, and queues qualified leads for outreach. Configurable daily discovery cap (default: 50).                         |
| Automated Outreach Sending          | Generates personalized messages and sends them via the configured email provider. Staggers sends with randomized 30–120 second delays to avoid spam filters.                                           |
| Automated Follow-Up Sequences       | Follows up with non-responsive prospects on a configurable cadence (default: 3, 5, 7 days). References previous messages to maintain context. Max follow-ups configurable (default: 3).                |
| Response Detection & Classification | AI classifies incoming replies as: interested, not_interested, objection, question, or out_of_office. Confidence scoring with manual review flagging below 0.7.                                        |
| Automated CRM Transitions           | Interested → Replied, Not Interested → Closed, Objection/Question → Replied + contextual response, Out of Office → Sequence paused until return date.                                                  |
| Automated Meeting Booking           | Booking agent queries calendar availability, proposes up to 3 time slots, handles confirmations, and creates calendar events with full context.                                                        |
| Pipeline Run Tracking               | Every run is persisted with status, timestamps, stage completion, metrics (discovered, sent, replies, meetings), and error details.                                                                    |
| Stale Run Detection                 | Detects and recovers from stale/hung pipeline runs.                                                                                                                                                    |
| Project-Level Run Scoping           | Run the pipeline for all projects, a single project, or a single ICP profile within a project. Three-level cascading selector.                                                                         |
| Quality Gates                       | Pre-send checks: personalization element required, word limit enforced, minimum lead score threshold, valid email required, no duplicate sends within 24 hours.                                        |

### 6. Email Integration

| Feature               | Description                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Gmail OAuth           | Connect Gmail via OAuth 2.0 for sending and receiving.                                                               |
| Custom SMTP/IMAP      | Connect any SMTP server for sending and any IMAP server for inbox monitoring. Supports TLS, STARTTLS, and plaintext. |
| Provider Switching    | Switch between Gmail and SMTP/IMAP at any time. Both configurations retained simultaneously.                         |
| IMAP Inbox Monitoring | Polls configured IMAP folders at configurable intervals (1–60 min). Tracks last-seen UID to avoid reprocessing.      |
| Message Threading     | Matches incoming replies to outreach threads using In-Reply-To, References, and sender email fallback.               |
| Credential Security   | All passwords and tokens encrypted at rest using AES-256-GCM. Decrypted only at moment of use.                       |
| Test Connections      | Test SMTP and IMAP connections before activation.                                                                    |
| Email Signature       | Configurable email signature appended to all outreach.                                                               |
| Sending Name          | Configurable display name for outgoing emails.                                                                       |

### 7. Calendar Integration

| Feature                  | Description                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Google Calendar OAuth    | Connect Google Calendar for availability checking and event creation.                                                |
| Availability Windows     | Configure which days and time ranges are available for meetings (default: Mon–Fri, 9–5 in your timezone).            |
| Automatic Event Creation | Calendar events include prospect name, company, role, and context summary. Calendar invite sent to prospect's email. |
| Conflict Detection       | Reads existing calendar events to exclude busy slots.                                                                |

### 8. Throttle & Rate Limiting

| Feature                  | Description                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Daily Send Limits        | Configurable per-channel limits (email/DM), 5–50 per channel, default 20.                                                                 |
| Combined Enforcement     | Manual and automated sends count against the same daily limit.                                                                            |
| Warning Threshold        | Visual warning at 80% capacity.                                                                                                           |
| Source-Level Rate Limits | Per-source rate limits for discovery (Google, LinkedIn, GitHub, Twitter, SMTP). Daily scraping budgets. Exponential backoff for HTTP 429. |

### 9. Insights & Call Notes

| Feature                       | Description                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Structured Call Notes         | Record pain points, objections, feature requests, next steps, and sentiment after conversations. |
| AI-Inferred Sentiment         | When sentiment isn't explicitly provided, the system infers it from the note text.               |
| Structured Tag Generation     | AI extracts structured tags (pain_point, objection, feature_request) from free-text notes.       |
| Aggregated Insights           | View pain point frequency, objection patterns, and feature request trends across all leads.      |
| Project-Scoped Insights       | Lead selector filtered by the currently selected project.                                        |
| Call Notes in Personalization | Recorded insights feed directly into message generation for returning prospects.                 |

### 10. Dashboard & Analytics

| Feature                   | Description                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Weekly Summary            | Leads contacted, reply rate, meetings booked, conversion rate, CRM status counts.                    |
| Pipeline Metrics          | Real-time: prospects discovered today, messages sent, replies received, meetings booked, reply rate. |
| Pipeline Status           | Running/paused/error indicator with last run timestamp and next scheduled run.                       |
| Conversation Threads      | Full message history per prospect (sent and received).                                               |
| Manual Review Queue       | Low-confidence classifications flagged for founder review with suggested actions.                    |
| High-Priority Suggestions | Leads with score > 80 that haven't been contacted yet.                                               |
| Outreach Summary          | Total sent, reply count, reply rate across all time.                                                 |
| Outreach History          | Full history table with date, lead, channel, type, and message content.                              |
| Stale Leads               | Prospects contacted 7+ days ago with no reply. Descriptive text and last contact date.               |

### 11. Messages Page (Composition Workspace)

| Feature                 | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| Lead Selector           | Choose any lead for message composition.                                         |
| Tone & Type Controls    | Select from 5 tones and 2 message types (cold email, cold DM).                   |
| AI Generation           | One-click message generation with full personalization pipeline.                 |
| Editable Output         | Generated message displayed in an editable textarea for review and modification. |
| Preview Panel           | Read-only formatted preview showing the message as the recipient would see it.   |
| Personalization Details | Breakdown of what data sources and details were used in personalization.         |

### 12. Outreach Page (Tracking & Analytics)

| Feature                 | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| Summary Stats           | Total sent, replies, reply rate at a glance.                                 |
| History Table           | All outreach records with date, lead, channel, type, and message.            |
| Stale Leads Section     | Toggle to view and re-engage stale prospects.                                |
| Throttle Status         | Visual progress bars showing daily usage and remaining capacity per channel. |
| No Composition Controls | Tracking only — composition is exclusive to the Messages page.               |

### 13. Landing Page & Design System

| Feature                   | Description                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Public Landing Page       | Conversion-focused homepage with hero, problem, solution, how-it-works, differentiation, trust, deliverability, pricing, and CTA sections. |
| Three Pricing Tiers       | Starter, Growth, and Pro/Scale with distinct feature sets.                                                                                 |
| Unified Design System     | CSS custom properties for colors, typography, spacing, and border-radius. Light and dark mode. Cascades to all pages.                      |
| Responsive Layout         | Mobile-first with single-column on narrow viewports, multi-column on desktop.                                                              |
| Smooth Section Navigation | Sticky nav with smooth scroll to anchored sections.                                                                                        |
| Accessibility             | Semantic HTML, keyboard navigation, focus indicators, ARIA labels, alt text.                                                               |

---

## Billing Tiers

### Starter — $29–79/mo

_For solo founders testing outbound for the first time._

| Category           | Included Features                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| ICP                | 1 project, 1 ICP profile, AI-generated from description                                                        |
| Discovery          | Basic web discovery (Google Search), 25 leads/day cap                                                          |
| Enrichment         | LinkedIn bio, company info, basic email discovery (pattern inference only)                                     |
| Scoring            | Standard scoring (ICP match + role relevance + intent signals)                                                 |
| Lead Management    | Up to 500 active leads, manual entry, duplicate detection, soft delete/restore, CRM pipeline                   |
| Message Generation | AI message generation, 3 tone presets (warm, professional, casual), basic personalization from enrichment data |
| Outreach           | Manual send tracking, outreach history, stale leads detection                                                  |
| Composition        | Messages page with lead selector, tone/type controls, AI generation, preview                                   |
| Throttle           | 20 emails/day, 20 DMs/day                                                                                      |
| Dashboard          | Weekly summary, CRM status counts, high-priority suggestions                                                   |
| Insights           | Call notes capture, sentiment (manual only), basic tag generation                                              |
| Email              | Gmail OAuth only                                                                                               |
| Calendar           | Not included                                                                                                   |
| Automation         | Not included — manual pipeline only                                                                            |
| Support            | Community support                                                                                              |

### Growth — $99–249/mo

_For founders ready to scale outbound with automation._

Everything in Starter, plus:

| Category           | Included Features                                                                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ICP                | Up to 5 projects, unlimited ICP profiles per project, per-project strategy toggle                                                                                                                                                                                                         |
| Discovery          | Full multi-source discovery (Google, LinkedIn, GitHub, Twitter, company websites), 100 leads/day cap, AI-powered query generation, retry with feedback                                                                                                                                    |
| Enrichment         | Full waterfall email discovery (web search → pattern inference → Hunter API → SMTP verification), AI Research Agent for deep prospect profiling, deep content extraction (fetches actual articles, AI summarization)                                                                      |
| Scoring            | Multi-ICP scoring with pain point relevance, correlation scoring                                                                                                                                                                                                                          |
| Lead Management    | Up to 5,000 active leads, lead search & autofill (Apollo), lead grouping by project, per-lead steering context                                                                                                                                                                            |
| Message Generation | All 5 tone presets (warm, professional, casual, direct, bold), research-based personalization with content-aware hooks, intersection analysis, on-demand research fallback, global steering context, call notes integration                                                               |
| Outreach           | Outreach summary stats, full history, throttle status visualization                                                                                                                                                                                                                       |
| Automation         | Automated pipeline orchestrator (discovery → outreach → follow-up → inbox), configurable run intervals and business hours, automated follow-up sequences (configurable cadence), response detection & classification, automated CRM transitions, project-level run scoping, quality gates |
| Email              | Gmail OAuth + Custom SMTP/IMAP, provider switching, IMAP inbox monitoring, message threading, credential encryption, test connections                                                                                                                                                     |
| Calendar           | Google Calendar OAuth, availability windows, automatic event creation, conflict detection                                                                                                                                                                                                 |
| Throttle           | 50 emails/day, 50 DMs/day, source-level rate limits                                                                                                                                                                                                                                       |
| Dashboard          | Full pipeline metrics, conversation threads, stale leads with last contact date                                                                                                                                                                                                           |
| Insights           | AI-inferred sentiment, structured tag generation, aggregated insights, project-scoped insights, call notes in personalization                                                                                                                                                             |
| Support            | Email support, 48-hour response time                                                                                                                                                                                                                                                      |

### Pro / Scale — $299–799/mo

_For founders running outbound at volume across multiple offerings._

Everything in Growth, plus:

| Category        | Included Features                                                                                                                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ICP             | Unlimited projects, AI-inferred project naming                                                                                                                                                                                                                                                                                    |
| Discovery       | 200+ leads/day cap, priority API access, Apollo integration as supplementary source                                                                                                                                                                                                                                               |
| Enrichment      | Priority enrichment processing, enrichment retry with exponential backoff (3 attempts), domain discovery via web search with MX validation, run-level caching for company data                                                                                                                                                    |
| Lead Management | Unlimited active leads                                                                                                                                                                                                                                                                                                            |
| Automation      | Automated meeting booking agent (proposes time slots, handles confirmations, creates calendar events), out-of-office detection with automatic sequence pausing and resumption, objection/question handling with contextual AI responses, manual review queue for low-confidence classifications, stale run detection and recovery |
| Throttle        | Custom limits (up to 200/day per channel), advanced deliverability controls                                                                                                                                                                                                                                                       |
| Dashboard       | Manual review queue, upcoming meetings display, low meeting prompt                                                                                                                                                                                                                                                                |
| Support         | Priority support, 24-hour response time, onboarding call                                                                                                                                                                                                                                                                          |

### Optional Add-On: Pay-Per-Meeting

Available on any tier. Success-based pricing where you pay per qualified meeting booked through the platform, in addition to or instead of the base subscription.

---

## Feature Availability Matrix

| Feature                        | Starter |  Growth   | Pro/Scale |
| ------------------------------ | :-----: | :-------: | :-------: |
| AI ICP Generation              |    ✓    |     ✓     |     ✓     |
| Multi-Project                  |    1    |     5     | Unlimited |
| Multi-ICP Profiles             |    1    | Unlimited | Unlimited |
| Per-Project Strategy           |    —    |     ✓     |     ✓     |
| AI-Inferred Project Names      |    —    |     —     |     ✓     |
| Web Discovery (Google)         |    ✓    |     ✓     |     ✓     |
| Multi-Source Discovery         |    —    |     ✓     |     ✓     |
| AI Query Generation            |    —    |     ✓     |     ✓     |
| Waterfall Email Discovery      |    —    |     ✓     |     ✓     |
| SMTP Email Verification        |    —    |     ✓     |     ✓     |
| AI Research Agent              |    —    |     ✓     |     ✓     |
| Deep Content Extraction        |    —    |     ✓     |     ✓     |
| Apollo Integration             |    —    |     —     |     ✓     |
| Lead Search & Autofill         |    —    |     ✓     |     ✓     |
| Multi-ICP Scoring              |    —    |     ✓     |     ✓     |
| Correlation Scoring            |    —    |     ✓     |     ✓     |
| Per-Lead Steering              |    —    |     ✓     |     ✓     |
| Lead Grouping by Project       |    —    |     ✓     |     ✓     |
| 5 Tone Presets                 |    3    |     5     |     5     |
| Research-Based Personalization |    —    |     ✓     |     ✓     |
| Content-Aware Hooks            |    —    |     ✓     |     ✓     |
| Global Steering Context        |    —    |     ✓     |     ✓     |
| Call Notes in Messages         |    —    |     ✓     |     ✓     |
| Automated Pipeline             |    —    |     ✓     |     ✓     |
| Follow-Up Sequences            |    —    |     ✓     |     ✓     |
| Response Classification        |    —    |     ✓     |     ✓     |
| Automated CRM Transitions      |    —    |     ✓     |     ✓     |
| Meeting Booking Agent          |    —    |     —     |     ✓     |
| Out-of-Office Handling         |    —    |     —     |     ✓     |
| Manual Review Queue            |    —    |     —     |     ✓     |
| Gmail OAuth                    |    ✓    |     ✓     |     ✓     |
| Custom SMTP/IMAP               |    —    |     ✓     |     ✓     |
| Google Calendar                |    —    |     ✓     |     ✓     |
| AI Sentiment Inference         |    —    |     ✓     |     ✓     |
| Aggregated Insights            |    —    |     ✓     |     ✓     |
| Pipeline Metrics Dashboard     |    —    |     ✓     |     ✓     |
| Conversation Threads           |    —    |     ✓     |     ✓     |
| Daily Lead Cap                 |   25    |    100    |   200+    |
| Daily Send Limit               |   20    |    50     |  Custom   |
| Active Lead Limit              |   500   |   5,000   | Unlimited |

---

## Technical Stack

- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, PostgreSQL
- **AI**: OpenAI GPT-4o (message generation, research synthesis, ICP generation, response classification, content summarization, query generation), GPT-4o-mini (project naming)
- **Email**: Gmail OAuth, Custom SMTP/IMAP, AES-256-GCM credential encryption
- **Calendar**: Google Calendar OAuth
- **Discovery**: Serper.dev (Google Search API), Playwright (web scraping), Apollo.io (optional)
- **Scheduling**: Node-cron for background pipeline execution
