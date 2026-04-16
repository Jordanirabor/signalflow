# Requirements Document: Automated Calendar Pipeline

## Introduction

The Automated Calendar Pipeline transforms SignalFlow from a manual GTM tool into a fully automated engine that fills a founder's daily calendar with high-quality 1:1 meetings. The system autonomously discovers prospects matching the founder's ICP, generates and sends personalized outreach, handles responses and follow-ups, and books meetings on the founder's calendar — all without manual intervention. It adapts to any product or niche by deriving outreach strategy from the founder's product context and ICP definition.

This feature builds on the existing SignalFlow infrastructure (Next.js, Postgres, OpenAI, lead/scoring/enrichment/message services) and extends it with an autonomous pipeline orchestrator, email/calendar integrations, response classification, and automated scheduling.

## Glossary

- **Pipeline_Orchestrator**: The background scheduling engine that coordinates all automated pipeline stages (discovery, outreach, follow-up, booking) without manual founder intervention
- **Prospect**: A Lead that has been automatically discovered and qualified by the Pipeline_Orchestrator as matching the founder's ICP
- **Outreach_Sequence**: An ordered series of messages (initial contact plus follow-ups) automatically sent to a Prospect over a defined cadence
- **Response_Classifier**: The AI component that analyzes incoming replies from Prospects and categorizes them as interested, not_interested, objection, question, or out_of_office
- **Booking_Agent**: The AI component that negotiates meeting times with interested Prospects and creates calendar events
- **Calendar_Integration**: The connection to the founder's calendar provider (Google Calendar or Outlook) used to check availability and create meeting events
- **Email_Integration**: The connection to the founder's email provider used to send outreach and receive replies
- **Sequence_Cadence**: The timing rules governing when follow-up messages are sent (e.g., 3 days after initial, 5 days after first follow-up)
- **Quality_Gate**: A set of automated checks that prevent low-quality or spammy outreach from being sent
- **Pipeline_Run**: A single execution cycle of the Pipeline_Orchestrator that processes all pending pipeline actions
- **Availability_Window**: The time slots the founder has marked as available for meetings on their calendar
- **Conversation_Thread**: The full chain of messages exchanged between the system and a single Prospect

## Requirements

### Requirement 1: Pipeline Orchestrator Scheduling

**User Story:** As a founder, I want the system to run autonomously on a schedule, so that prospects are discovered, contacted, and followed up with without me triggering each step manually.

#### Acceptance Criteria

1. THE Pipeline_Orchestrator SHALL execute Pipeline_Runs on a configurable interval (default: every 60 minutes during business hours)
2. WHEN a Pipeline_Run executes, THE Pipeline_Orchestrator SHALL process all pending actions across discovery, outreach, follow-up, and booking stages in sequence
3. THE Pipeline_Orchestrator SHALL persist the status and timestamp of each Pipeline_Run to the database
4. IF a Pipeline_Run fails at any stage, THEN THE Pipeline_Orchestrator SHALL log the failure, skip the failed action, and continue processing remaining actions in the run
5. WHEN the founder pauses the Pipeline_Orchestrator, THE Pipeline_Orchestrator SHALL stop executing new Pipeline_Runs and complete any in-progress run before halting
6. THE Pipeline_Orchestrator SHALL expose a status endpoint reporting the current state (running, paused, error), last run timestamp, and next scheduled run time
7. WHEN the founder resumes the Pipeline_Orchestrator, THE Pipeline_Orchestrator SHALL begin executing Pipeline_Runs from the next scheduled interval

### Requirement 2: Automated Prospect Discovery

**User Story:** As a founder, I want the system to automatically find new prospects matching my ICP, so that my pipeline is always full without manual searching.

#### Acceptance Criteria

1. WHEN a Pipeline_Run executes the discovery stage, THE Pipeline_Orchestrator SHALL query configured data sources for Prospects matching the active ICP
2. THE Pipeline_Orchestrator SHALL score each discovered Prospect using the existing scoring service and add only Prospects with a Lead_Score of 50 or above to the Lead_List
3. THE Pipeline_Orchestrator SHALL enrich each qualifying Prospect with Enrichment_Data before adding the Prospect to the outreach queue
4. THE Pipeline_Orchestrator SHALL enforce a configurable daily discovery cap (default: 50 Prospects per day) to prevent database bloat
5. IF a discovered Prospect already exists in the Lead_List (duplicate by name and company), THEN THE Pipeline_Orchestrator SHALL skip the Prospect and log the duplicate detection
6. THE Pipeline_Orchestrator SHALL record the data source and discovery timestamp for each Prospect added to the Lead_List

### Requirement 3: Niche-Adaptive Outreach Strategy

**User Story:** As a founder, I want the system to adapt its outreach approach to my specific product and niche, so that messages resonate regardless of what I'm building.

#### Acceptance Criteria

1. WHEN the founder configures the pipeline, THE Pipeline_Orchestrator SHALL accept a product context description, value proposition, and target pain points as strategy inputs
2. THE Pipeline_Orchestrator SHALL use the strategy inputs combined with the ICP definition to generate niche-specific outreach templates via the Message_Generator
3. WHEN generating an Outreach_Message for a Prospect, THE Message_Generator SHALL incorporate the founder's product context, the Prospect's Enrichment_Data, and the Prospect's industry-specific context
4. THE Pipeline_Orchestrator SHALL support configurable tone preference (professional, casual, or direct) applied consistently across all automated messages
5. WHEN the founder updates strategy inputs, THE Pipeline_Orchestrator SHALL apply the updated strategy to all future Outreach_Messages without affecting already-sent messages

### Requirement 4: Automated Outreach Sending

**User Story:** As a founder, I want the system to automatically send personalized outreach messages to qualified prospects, so that I don't have to manually copy, paste, and send each message.

#### Acceptance Criteria

1. WHEN a Prospect enters the outreach queue, THE Pipeline_Orchestrator SHALL generate a personalized Outreach_Message and send it via the configured Email_Integration
2. THE Pipeline_Orchestrator SHALL update the Prospect's CRM_Status from "New" to "Contacted" after successfully sending the initial Outreach_Message
3. THE Pipeline_Orchestrator SHALL record each sent message in the outreach_record table with the channel, content, and timestamp
4. THE Pipeline_Orchestrator SHALL respect the existing Throttle_Limit configuration when sending automated outreach (default: 20 per channel per day)
5. IF the Email_Integration fails to send a message, THEN THE Pipeline_Orchestrator SHALL mark the Prospect as "send_failed", log the error, and retry the send in the next Pipeline_Run
6. THE Pipeline_Orchestrator SHALL stagger outreach sends with a randomized delay of 30 to 120 seconds between messages to avoid triggering spam filters
7. WHEN the daily Throttle_Limit is reached, THE Pipeline_Orchestrator SHALL queue remaining Prospects for the next calendar day

### Requirement 5: Automated Follow-Up Sequences

**User Story:** As a founder, I want the system to automatically follow up with prospects who haven't responded, so that no opportunity falls through the cracks.

#### Acceptance Criteria

1. WHEN a Prospect has not replied within the configured Sequence_Cadence interval after the last message, THE Pipeline_Orchestrator SHALL generate and send a follow-up message
2. THE Pipeline_Orchestrator SHALL support a configurable maximum number of follow-ups per Prospect (default: 3 follow-ups)
3. WHEN generating a follow-up message, THE Message_Generator SHALL reference the previous messages in the Conversation_Thread to maintain context and avoid repetition
4. THE Pipeline_Orchestrator SHALL mark the outreach_record entry as a follow-up (is_follow_up = true) for each automated follow-up
5. WHEN a Prospect has received the maximum number of follow-ups without replying, THE Pipeline_Orchestrator SHALL move the Prospect's CRM_Status to "Closed" with reason "no_response"
6. THE Pipeline_Orchestrator SHALL support configurable Sequence_Cadence intervals (default: 3 days after initial, 5 days after first follow-up, 7 days after second follow-up)

### Requirement 6: Response Detection and Classification

**User Story:** As a founder, I want the system to automatically detect and classify prospect responses, so that interested prospects are fast-tracked to booking and objections are handled appropriately.

#### Acceptance Criteria

1. WHEN a reply is received from a Prospect via the Email_Integration, THE Response_Classifier SHALL classify the reply into one of: interested, not_interested, objection, question, or out_of_office
2. WHEN a reply is classified as "interested", THE Pipeline_Orchestrator SHALL update the Prospect's CRM_Status to "Replied" and pass the Prospect to the Booking_Agent
3. WHEN a reply is classified as "not_interested", THE Pipeline_Orchestrator SHALL update the Prospect's CRM_Status to "Closed" with reason "not_interested" and stop the Outreach_Sequence
4. WHEN a reply is classified as "objection" or "question", THE Pipeline_Orchestrator SHALL generate a contextual response addressing the objection or question and send it via the Email_Integration
5. WHEN a reply is classified as "out_of_office", THE Pipeline_Orchestrator SHALL pause the Outreach_Sequence for the Prospect and resume it after the detected return date
6. THE Response_Classifier SHALL store the raw reply text, classification result, and confidence score for each classified response
7. IF the Response_Classifier confidence score is below 0.7, THEN THE Pipeline_Orchestrator SHALL flag the reply for manual founder review instead of taking automated action

### Requirement 7: Automated Meeting Booking

**User Story:** As a founder, I want the system to automatically book meetings with interested prospects on my calendar, so that my day fills up with high-quality conversations without scheduling back-and-forth.

#### Acceptance Criteria

1. WHEN the Booking_Agent receives an interested Prospect, THE Booking_Agent SHALL query the founder's Calendar_Integration for available time slots within the next 7 business days
2. THE Booking_Agent SHALL propose up to 3 available time slots to the Prospect via the Email_Integration in a single message
3. WHEN the Prospect confirms a time slot, THE Booking_Agent SHALL create a calendar event on the founder's calendar with the Prospect's name, company, role, and a brief context summary
4. WHEN the Booking_Agent creates a calendar event, THE Pipeline_Orchestrator SHALL update the Prospect's CRM_Status to "Booked" and record the meeting date in the status_change table
5. IF the Prospect does not respond to the booking proposal within 48 hours, THEN THE Booking_Agent SHALL send one follow-up with updated available time slots
6. IF the Prospect declines all proposed time slots, THEN THE Booking_Agent SHALL propose a new set of available time slots from the following week
7. THE Booking_Agent SHALL respect the founder's configured Availability_Window and exclude time slots outside the window

### Requirement 8: Calendar Integration

**User Story:** As a founder, I want to connect my calendar so the system can check my availability and book meetings directly, so that there are no scheduling conflicts.

#### Acceptance Criteria

1. THE Calendar_Integration SHALL support connecting to Google Calendar via OAuth 2.0
2. WHEN the founder connects a calendar, THE Calendar_Integration SHALL verify the connection by reading the founder's upcoming events
3. THE Calendar_Integration SHALL read the founder's existing calendar events to determine available time slots, excluding events marked as busy
4. WHEN creating a meeting event, THE Calendar_Integration SHALL include a calendar invite sent to the Prospect's email address
5. IF the Calendar_Integration loses its OAuth token, THEN THE Calendar_Integration SHALL notify the founder and pause the Booking_Agent until the connection is re-established
6. THE Calendar_Integration SHALL support configuring Availability_Windows where the founder specifies days of the week and time ranges available for meetings (default: Monday–Friday, 9:00 AM–5:00 PM in the founder's timezone)

### Requirement 9: Email Integration

**User Story:** As a founder, I want to connect my email so the system can send outreach and receive replies on my behalf, so that the entire outreach flow is automated.

#### Acceptance Criteria

1. THE Email_Integration SHALL support connecting to Gmail via OAuth 2.0
2. WHEN the founder connects an email account, THE Email_Integration SHALL verify the connection by sending a test message to the founder's own address
3. THE Email_Integration SHALL send outreach messages from the founder's connected email address so replies come back to the founder's inbox
4. THE Email_Integration SHALL monitor the founder's inbox for replies to outreach messages by matching reply threads to sent Outreach_Messages
5. IF the Email_Integration loses its OAuth token, THEN THE Email_Integration SHALL notify the founder and pause all automated outreach until the connection is re-established
6. THE Email_Integration SHALL support configuring a sending name and email signature appended to all outreach messages

### Requirement 10: Quality Gates and Spam Prevention

**User Story:** As a founder, I want built-in quality controls on automated outreach, so that my reputation is protected and meetings are genuinely high-quality.

#### Acceptance Criteria

1. THE Quality_Gate SHALL verify that every Outreach_Message contains at least one personalization element from the Prospect's Enrichment_Data before allowing the send
2. THE Quality_Gate SHALL reject any Outreach_Message that exceeds the word limit (150 words for DMs, 250 words for emails)
3. THE Quality_Gate SHALL enforce a minimum Lead_Score threshold (configurable, default: 50) for Prospects entering the outreach queue
4. THE Pipeline_Orchestrator SHALL enforce the existing Throttle_Limit system for all automated sends, combining manual and automated outreach counts against the daily limit
5. THE Quality_Gate SHALL detect and prevent sending duplicate messages to the same Prospect within a 24-hour window
6. WHEN the Quality_Gate rejects a message, THE Pipeline_Orchestrator SHALL log the rejection reason and skip the Prospect for the current Pipeline_Run
7. THE Quality_Gate SHALL verify that the Prospect has a valid email address before attempting to send outreach

### Requirement 11: Pipeline Dashboard and Monitoring

**User Story:** As a founder, I want to see how the automated pipeline is performing, so that I can understand my funnel metrics and intervene when needed.

#### Acceptance Criteria

1. THE Dashboard SHALL display real-time Pipeline_Orchestrator status (running, paused, error) and the timestamp of the last completed Pipeline_Run
2. THE Dashboard SHALL display daily automated pipeline metrics: Prospects discovered, messages sent, replies received, meetings booked, and reply rate as a percentage
3. THE Dashboard SHALL display the Conversation_Thread for each Prospect showing all sent and received messages in chronological order
4. THE Dashboard SHALL provide controls to pause, resume, and manually trigger a Pipeline_Run
5. WHEN the Pipeline_Orchestrator encounters an error that requires founder attention, THE Dashboard SHALL display a notification with the error details and suggested resolution
6. THE Dashboard SHALL display a list of Prospects flagged for manual review (low-confidence classifications) with the reply text and suggested action
7. THE Dashboard SHALL display the founder's calendar for the current week with booked meetings highlighted

### Requirement 12: Pipeline Configuration

**User Story:** As a founder, I want to configure the automated pipeline's behavior, so that I can tune it to my preferences and outreach style.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a configuration interface for all pipeline parameters: Pipeline_Run interval, discovery cap, Sequence_Cadence intervals, maximum follow-ups, minimum Lead_Score threshold, and tone preference
2. WHEN the founder updates pipeline configuration, THE Pipeline_Orchestrator SHALL apply the new configuration starting from the next Pipeline_Run
3. THE Pipeline_Orchestrator SHALL use sensible defaults for all configuration parameters so the founder can start the pipeline with minimal setup
4. THE Dashboard SHALL validate all configuration inputs: Pipeline_Run interval between 15 and 240 minutes, discovery cap between 10 and 200, maximum follow-ups between 1 and 5, minimum Lead_Score between 30 and 90
5. IF the founder submits a configuration value outside the allowed range, THEN THE Dashboard SHALL display a validation error with the allowed range
