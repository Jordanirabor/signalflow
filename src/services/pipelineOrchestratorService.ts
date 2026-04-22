import { query } from '@/lib/db';
import { handleDecline, handleProposalExpiry, proposeSlots } from '@/services/bookingAgentService';
import { scoreAndStoreCorrelation } from '@/services/correlationEngineService';
import { changeLeadStatus } from '@/services/crmService';
import { discoverLeadsMultiICP } from '@/services/discovery/discoveryEngine';
import { logPipelineRunSummary, logStructured } from '@/services/discovery/discoveryLogger';
import {
  enrichProspect,
  mergeEnrichmentWithExisting,
} from '@/services/discovery/enrichmentPipeline';
import { createRunCache } from '@/services/discovery/runCache';
import { getEmailConnection, pollInbox, sendEmail } from '@/services/emailIntegrationService';
import { enrichLead } from '@/services/enrichmentService';
import { getActiveProfiles, getICPProfileById } from '@/services/icpProfileService';
import { getEnrichedICP } from '@/services/icpService';
import { createLead, findDuplicate, updateLeadEnrichment } from '@/services/leadService';
import { generateMessage, generateMessageWithResearchFallback } from '@/services/messageService';
import { getOutreachHistory, recordOutreach } from '@/services/outreachService';
import { getPipelineConfig } from '@/services/pipelineConfigService';
import { getResearchProfile } from '@/services/prospectResearcherService';
import { runAllChecks } from '@/services/qualityGateService';
import { classifyReply } from '@/services/responseClassifierService';
import { calculateLeadScoreV2 } from '@/services/scoringService';
import { extractStrategy, formatStrategyForPrompt } from '@/services/strategyService';
import { canRecordOutreach } from '@/services/throttleService';
import type {
  EnrichmentData,
  PipelineConfig,
  PipelineRun,
  PipelineStatus,
  ResearchProfile,
} from '@/types';

// ---------------------------------------------------------------------------
// Pipeline run DB row type
// ---------------------------------------------------------------------------

interface PipelineRunRow {
  id: string;
  founder_id: string;
  project_id: string | null;
  icp_profile_id: string | null;
  status: 'running' | 'completed' | 'failed' | 'partial';
  stages_completed: string[];
  stage_errors: Record<string, string>;
  prospects_discovered: number;
  messages_sent: number;
  replies_processed: number;
  meetings_booked: number;
  enrichments_retried: number;
  started_at: Date;
  completed_at: Date | null;
}

const PIPELINE_RUN_COLUMNS = `id, founder_id, project_id, icp_profile_id, status, stages_completed, stage_errors,
  prospects_discovered, messages_sent, replies_processed, meetings_booked,
  enrichments_retried, started_at, completed_at`;

function mapRunRow(row: PipelineRunRow): PipelineRun {
  return {
    id: row.id,
    founderId: row.founder_id,
    projectId: row.project_id ?? undefined,
    icpProfileId: row.icp_profile_id ?? undefined,
    status: row.status,
    stagesCompleted: row.stages_completed,
    stageErrors: row.stage_errors,
    prospectsDiscovered: row.prospects_discovered,
    messagesSent: row.messages_sent,
    repliesProcessed: row.replies_processed,
    meetingsBooked: row.meetings_booked,
    enrichmentsRetried: row.enrichments_retried,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Stuck Pipeline Cleanup
// ---------------------------------------------------------------------------

/** Max age in minutes before a "running" pipeline is considered stuck */
const STUCK_RUN_THRESHOLD_MINUTES = 10;

/**
 * Mark any pipeline runs that have been in "running" status for longer than
 * the threshold as "failed". This prevents stuck runs from blocking new ones.
 * Safe to call on every application start and periodically during runtime.
 */
export async function cleanupStuckPipelineRuns(): Promise<number> {
  try {
    const result = await query<{ id: string }>(
      `UPDATE pipeline_run
       SET status = 'failed',
           stage_errors = COALESCE(stage_errors, '{}'::jsonb) || '{"_cleanup": "stuck_run_auto_recovered"}'::jsonb,
           completed_at = NOW()
       WHERE status = 'running'
         AND started_at < NOW() - INTERVAL '${STUCK_RUN_THRESHOLD_MINUTES} minutes'
       RETURNING id`,
      [],
    );

    if (result.rows.length > 0) {
      console.log(
        `[PipelineCleanup] Recovered ${result.rows.length} stuck pipeline run(s): ${result.rows.map((r) => r.id).join(', ')}`,
      );
    }

    return result.rows.length;
  } catch (err) {
    console.error(
      '[PipelineCleanup] Failed to clean up stuck runs:',
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Pipeline stages — stubs to be filled in by later tasks
// ---------------------------------------------------------------------------

export interface StageResult {
  prospectsDiscovered?: number;
  messagesSent?: number;
  repliesProcessed?: number;
  meetingsBooked?: number;
  enrichmentsRetried?: number;
}

/**
 * Execute the discovery stage of a pipeline run.
 *
 * - Queries data sources for prospects matching the founder's ICP
 * - Scores each prospect using scoringService, filters by minLeadScore
 * - Enriches qualifying prospects using enrichmentService
 * - Enforces daily discovery cap from pipeline config
 * - Skips duplicates (by name and company already in lead table)
 * - Records discovery source and timestamp on each new lead
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */
async function executeDiscoveryStage(
  founderId: string,
  projectId: string,
  icpProfileId?: string,
): Promise<StageResult> {
  const config = await getPipelineConfig(founderId);

  let activeProfiles;

  if (icpProfileId) {
    // Single-profile run: use only the specified profile (Req 4.2)
    const profile = await getICPProfileById(icpProfileId);
    if (!profile || !profile.isActive) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'warn',
        message: 'Specified ICP profile is inactive or not found. Skipping discovery stage.',
        metadata: { founderId, projectId, icpProfileId },
      });
      return { prospectsDiscovered: 0 };
    }
    activeProfiles = [profile];
  } else {
    // All-profiles run: fetch all active ICP profiles for the project
    activeProfiles = await getActiveProfiles(founderId, projectId);
  }
  if (activeProfiles.length === 0) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'discovery',
      level: 'warn',
      message: 'No active ICP profiles for founder/project. Skipping discovery stage.',
      metadata: { founderId, projectId },
    });
    return { prospectsDiscovered: 0 };
  }

  // Check how many prospects were already discovered today for this project (daily cap enforcement)
  const todayCountResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM lead
     WHERE founder_id = $1
       AND project_id = $2
       AND discovered_at >= CURRENT_DATE
       AND discovered_at < CURRENT_DATE + INTERVAL '1 day'`,
    [founderId, projectId],
  );
  const discoveredToday = parseInt(todayCountResult.rows[0].count, 10);
  const remaining = Math.max(0, config.dailyDiscoveryCap - discoveredToday);

  if (remaining === 0) {
    return { prospectsDiscovered: 0 };
  }

  // Discover prospects matching all active ICP profiles
  const discoveryResult = await discoverLeadsMultiICP(activeProfiles, remaining);
  let added = 0;

  // Build a lookup map for profiles
  const profileMap = new Map(activeProfiles.map((p) => [p.id, p]));

  for (const prospect of discoveryResult.prospects) {
    // Skip duplicates by name and company
    const duplicate = await findDuplicate(founderId, prospect.name, prospect.company);
    if (duplicate) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Skipping duplicate: "${prospect.name}" (${prospect.company})`,
        metadata: { prospectName: prospect.name, company: prospect.company },
      });
      continue;
    }

    // The prospect already has a score from discoverLeadsMultiICP
    // But we filter by minimum score threshold
    if (prospect.score < config.minLeadScore) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Skipping low score: "${prospect.name}" score=${prospect.score} < min=${config.minLeadScore}`,
        metadata: {
          prospectName: prospect.name,
          score: prospect.score,
          minLeadScore: config.minLeadScore,
        },
      });
      continue;
    }

    // Look up the originating ICPProfile for V2 scoring
    const originatingProfile = profileMap.get(prospect.icpProfileId);
    if (!originatingProfile) continue;

    // Score using V2 scoring with the originating ICPProfile
    const scoreResult = calculateLeadScoreV2({
      lead: {
        role: prospect.role,
        company: prospect.company,
        industry: prospect.industry,
        geography: prospect.geography,
        enrichmentData: undefined,
      },
      icpProfile: originatingProfile,
    });

    // Create the lead with icp_profile_id and project_id
    let lead;
    try {
      lead = await createLead(
        {
          founderId,
          name: prospect.name,
          role: prospect.role,
          company: prospect.company,
          industry: prospect.industry,
          geography: prospect.geography,
          icpProfileId: prospect.icpProfileId,
          projectId,
        },
        scoreResult.totalScore,
        scoreResult.breakdown,
      );
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'info',
        message: `Created lead: "${lead.name}" (${lead.company}) score=${lead.leadScore}`,
        leadId: lead.id,
        metadata: { leadName: lead.name, company: lead.company, score: lead.leadScore },
      });
    } catch (err) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'error',
        message: `Failed to create lead "${prospect.name}": ${err instanceof Error ? err.message : String(err)}`,
        metadata: {
          prospectName: prospect.name,
          error: err instanceof Error ? err.message : String(err),
        },
        retryEligible: false,
      });
      continue;
    }

    // Record discovery source and timestamp
    await query(`UPDATE lead SET discovery_source = $1, discovered_at = NOW() WHERE id = $2`, [
      'icp_discovery',
      lead.id,
    ]);

    // Enrich the lead (with timeout to prevent hanging)
    try {
      await withTimeout(
        (async () => {
          const enrichResult = await enrichLead(lead.name, lead.company);
          await updateLeadEnrichment(
            lead.id,
            enrichResult.enrichmentData,
            enrichResult.enrichmentStatus,
            originatingProfile,
            enrichResult.emailDiscoveryMethod,
            enrichResult.emailDiscoverySteps,
          );

          // Trigger correlation scoring after enrichment completes (Req 3.1)
          try {
            const enrichedICP = await getEnrichedICP(founderId);
            if (enrichedICP) {
              const researchProfile: ResearchProfile = (await getResearchProfile(lead.id)) ?? {
                leadId: lead.id,
                topicsOfInterest: [],
                currentChallenges: [],
                recentActivity: [],
                publishedContentSummaries: [],
                overallSentiment: 'neutral',
                sourcesUsed: [],
                sourcesUnavailable: [],
                researchedAt: new Date(),
              };
              await scoreAndStoreCorrelation(lead, researchProfile, enrichedICP);
            }
          } catch (error) {
            logStructured({
              timestamp: new Date().toISOString(),
              stage: 'discovery',
              level: 'error',
              message: `Correlation scoring failed for lead "${lead.name}": ${error instanceof Error ? error.message : String(error)}`,
              leadId: lead.id,
              metadata: {
                leadName: lead.name,
                error: error instanceof Error ? error.message : String(error),
              },
              retryEligible: true,
            });
          }
        })(),
        120_000,
        `enrichment for "${lead.name}"`,
      );
    } catch (err) {
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'discovery',
        level: 'error',
        message: `Enrichment failed/timed out for "${lead.name}": ${err instanceof Error ? err.message : String(err)}`,
        leadId: lead.id,
        metadata: {
          leadName: lead.name,
          error: err instanceof Error ? err.message : String(err),
        },
        retryEligible: true,
      });
    }

    added++;
  }

  return { prospectsDiscovered: added };
}

/**
 * Calculate the retry backoff delay in minutes for a given attempt number.
 * Returns the backoff minutes for attempts 0–2, or null for attempt ≥ 3
 * (indicating no more retries should be scheduled).
 *
 * Exported as a pure function for property testing.
 *
 * Requirements: 5.2 (Property 10)
 */
export function calculateRetryBackoff(attempt: number): number | null {
  const backoffSchedule = [1, 5, 25];
  return attempt < backoffSchedule.length ? backoffSchedule[attempt] : null;
}

/**
 * Execute the enrichment retry stage of a pipeline run.
 *
 * - Queries leads with enrichment_status = 'pending' or 'partial',
 *   enrichment_retry_count < 3, and enrichment_next_retry_at <= NOW()
 * - For each lead, re-runs the enrichment pipeline (skipping disabled adapters)
 * - Merges new data with existing partial data
 * - On success: updates enrichment data, sets status to 'complete' or 'partial'
 * - On failure: increments retry count, calculates next retry with exponential backoff
 * - On max retries exceeded (≥ 3): marks as permanently failed
 * - Logs each retry attempt with lead ID, attempt number, sources attempted, outcome
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
async function executeEnrichmentRetryStage(
  founderId: string,
  projectId: string,
): Promise<StageResult> {
  // Query leads eligible for enrichment retry
  const leadsResult = await query<{
    id: string;
    name: string;
    company: string;
    role: string;
    enrichment_data: EnrichmentData | null;
    enrichment_status: string;
    enrichment_retry_count: number;
    icp_profile_id: string | null;
    linkedin_url: string | null;
    email: string | null;
  }>(
    `SELECT id, name, company, role, enrichment_data, enrichment_status,
            enrichment_retry_count, icp_profile_id,
            (enrichment_data->>'linkedinUrl')::text AS linkedin_url,
            email
     FROM lead
     WHERE founder_id = $1
       AND project_id = $2
       AND is_deleted = false
       AND (enrichment_status = 'pending' OR enrichment_status = 'partial')
       AND enrichment_retry_count < 3
       AND (enrichment_next_retry_at IS NULL OR enrichment_next_retry_at <= NOW())
       AND updated_at > NOW() - INTERVAL '7 days'
     ORDER BY enrichment_retry_count ASC, updated_at ASC
     LIMIT 10`,
    [founderId, projectId],
  );

  if (leadsResult.rows.length === 0) {
    return { enrichmentsRetried: 0 };
  }

  const cache = createRunCache();
  let enrichmentsRetried = 0;

  for (const lead of leadsResult.rows) {
    const attempt = lead.enrichment_retry_count;

    // Build prospect context for enrichment pipeline
    const prospect = {
      name: lead.name,
      company: lead.company,
      role: lead.role,
      linkedinUrl: lead.linkedin_url ?? undefined,
      companyDomain: undefined,
    };

    let outcome: 'success' | 'failure' | 'partial' = 'failure';
    let sourcesAttempted: string[] = [];
    let errorMessage: string | undefined;

    try {
      // Re-run enrichment pipeline (enrichProspect already skips disabled health-state adapters)
      const enrichResult = await enrichProspect(prospect, cache);

      sourcesAttempted = enrichResult.enrichmentData.dataSources ?? [];

      if (
        enrichResult.enrichmentStatus === 'complete' ||
        enrichResult.enrichmentStatus === 'partial'
      ) {
        // Merge new data with existing partial data
        const existingData = lead.enrichment_data ?? {};
        const mergedData = mergeEnrichmentWithExisting(existingData, enrichResult.enrichmentData);

        // Determine final status
        const finalStatus = enrichResult.enrichmentStatus;
        outcome = finalStatus === 'complete' ? 'success' : 'partial';

        // Look up the ICP profile for re-scoring
        if (lead.icp_profile_id) {
          const icpProfile = await getICPProfileById(lead.icp_profile_id);
          if (icpProfile) {
            await updateLeadEnrichment(
              lead.id,
              mergedData as EnrichmentData,
              finalStatus,
              icpProfile,
              enrichResult.emailDiscoveryMethod,
              enrichResult.emailDiscoverySteps,
            );
          }
        }

        // Clear retry tracking on success
        await query(
          `UPDATE lead
           SET enrichment_retry_count = $1,
               enrichment_next_retry_at = NULL,
               enrichment_last_error = NULL
           WHERE id = $2`,
          [attempt + 1, lead.id],
        );
      } else {
        // enrichment returned 'pending' — all adapters failed
        outcome = 'failure';
        errorMessage = 'All enrichment sources failed';
        await handleRetryFailure(lead.id, attempt, errorMessage);
      }
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : String(err);
      outcome = 'failure';
      await handleRetryFailure(lead.id, attempt, errorMessage);
    }

    // Log each retry attempt (Req 5.5)
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'enrichment_retry',
      level: outcome === 'failure' ? 'error' : 'info',
      message: `Enrichment retry attempt ${attempt + 1} for lead`,
      leadId: lead.id,
      metadata: {
        attempt: attempt + 1,
        sourcesAttempted,
        outcome,
        error: errorMessage,
      },
    });

    enrichmentsRetried++;
  }

  return { enrichmentsRetried };
}

/**
 * Handle enrichment retry failure: increment retry count, calculate backoff,
 * or mark as permanently failed if max retries exceeded.
 */
async function handleRetryFailure(
  leadId: string,
  currentAttempt: number,
  errorMessage: string,
): Promise<void> {
  const nextAttempt = currentAttempt + 1;
  const backoffMinutes = calculateRetryBackoff(nextAttempt);

  if (backoffMinutes === null) {
    // Max retries exceeded (≥ 3) — mark as permanently failed
    await query(
      `UPDATE lead
       SET enrichment_retry_count = $1,
           enrichment_next_retry_at = NULL,
           enrichment_last_error = $2
       WHERE id = $3`,
      [nextAttempt, `Permanently failed after ${nextAttempt} attempts: ${errorMessage}`, leadId],
    );
  } else {
    // Schedule next retry with exponential backoff
    await query(
      `UPDATE lead
       SET enrichment_retry_count = $1,
           enrichment_next_retry_at = NOW() + ($2 || ' minutes')::INTERVAL,
           enrichment_last_error = $3
       WHERE id = $4`,
      [nextAttempt, String(backoffMinutes), errorMessage, leadId],
    );
  }
}

/**
 * Generate a random stagger delay in [30, 120] seconds (inclusive).
 * Exported as a pure function for property testing.
 *
 * Requirements: 4.6 (Property 6)
 */
export function generateStaggerDelay(): number {
  return Math.floor(Math.random() * 91) + 30;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a promise with a timeout. Rejects with a TimeoutError if the promise
 * does not resolve within the given number of milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Execute the outreach stage of a pipeline run.
 *
 * - Queries leads in the outreach queue (status = 'New', with email, scored above threshold)
 * - Generates personalized messages using messageService with strategy inputs from strategyService
 * - Runs quality gate checks via qualityGateService.runAllChecks before sending
 * - Sends via emailIntegrationService.sendEmail
 * - Updates CRM status to Contacted via crmService
 * - Records in outreach_record with gmail_thread_id and gmail_message_id
 * - Staggers sends with randomized delay (30–120s) between messages
 * - Respects throttle limits via throttleService
 * - Queues overflow for next day when throttle limit reached
 *
 * Requirements: 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 10.4, 10.6
 */
async function executeOutreachStage(founderId: string): Promise<StageResult> {
  const config = await getPipelineConfig(founderId);
  const strategy = extractStrategy(config);

  // Query leads in the outreach queue: status = 'New', has email, score >= minLeadScore
  // Exclude leads flagged as low_correlation from automated outreach (Req 3.5)
  const leadsResult = await query<{
    id: string;
    name: string;
    role: string;
    company: string;
    industry: string | null;
    email: string;
    lead_score: number;
    enrichment_data: EnrichmentData | null;
  }>(
    `SELECT id, name, role, company, industry, email, lead_score, enrichment_data
     FROM lead
     WHERE founder_id = $1
       AND is_deleted = false
       AND crm_status = 'New'
       AND email IS NOT NULL
       AND email != ''
       AND lead_score >= $2
       AND (correlation_flag IS NULL OR correlation_flag != 'low_correlation')
     ORDER BY lead_score DESC`,
    [founderId, config.minLeadScore],
  );

  let messagesSent = 0;

  for (let i = 0; i < leadsResult.rows.length; i++) {
    const lead = leadsResult.rows[i];

    // Check throttle limit before each send
    const allowed = await canRecordOutreach(founderId, 'email');
    if (!allowed) {
      // Throttle limit reached — queue overflow for next day (Req 4.7)
      break;
    }

    // Get outreach history for duplicate check
    const outreachHistory = await getOutreachHistory(lead.id);

    // Generate personalized message using strategy inputs with research fallback
    const strategyPrompt = formatStrategyForPrompt(strategy);
    let messageResponse;
    try {
      messageResponse = await generateMessageWithResearchFallback(
        {
          leadName: lead.name,
          leadRole: lead.role,
          leadCompany: lead.company,
          enrichmentData: lead.enrichment_data ?? undefined,
          messageType: 'cold_email',
          tone: strategy.tonePreference,
          productContext: strategyPrompt,
        },
        lead.id,
      );
    } catch (err) {
      // Message generation failed — log structured error, skip lead, continue (Req 6.1, 6.3, 7.2)
      logStructured({
        timestamp: new Date().toISOString(),
        stage: 'outreach',
        level: 'error',
        message: `Message generation failed for lead "${lead.name}": ${err instanceof Error ? err.message : String(err)}`,
        leadId: lead.id,
        metadata: {
          leadName: lead.name,
          company: lead.company,
          error: err instanceof Error ? err.message : String(err),
        },
        retryEligible: true,
      });
      continue;
    }

    // Run quality gate checks before sending (Req 10.1–10.7)
    const qualityResult = runAllChecks({
      message: messageResponse.message,
      enrichmentData: lead.enrichment_data ?? undefined,
      channel: 'email',
      leadScore: lead.lead_score,
      minScore: config.minLeadScore,
      leadId: lead.id,
      outreachRecords: outreachHistory,
      email: lead.email,
    });

    if (!qualityResult.passed) {
      // Quality gate rejected — log and skip (Req 10.6)
      continue;
    }

    // Send via Gmail (Req 4.1, 9.3)
    let gmailThreadId: string;
    let gmailMessageId: string;
    try {
      const sendResult = await sendEmail(
        founderId,
        lead.email,
        messageResponse.subjectLine ||
          `${lead.name.split(/\s+/)[0]} + ${lead.company || 'quick question'}`,
        messageResponse.message,
      );
      gmailThreadId = sendResult.gmailThreadId;
      gmailMessageId = sendResult.gmailMessageId;
    } catch {
      // Send failed — skip, retry next run (Req 4.5)
      continue;
    }

    // Record outreach (Req 4.3)
    const outreachRecord = await recordOutreach({
      leadId: lead.id,
      founderId,
      channel: 'email',
      messageContent: messageResponse.message,
      isFollowUp: false,
    });

    // Update outreach_record with gmail_thread_id and gmail_message_id
    await query(
      `UPDATE outreach_record SET gmail_thread_id = $1, gmail_message_id = $2 WHERE id = $3`,
      [gmailThreadId, gmailMessageId, outreachRecord.id],
    );

    // Update CRM status to Contacted (Req 4.2)
    await changeLeadStatus({ leadId: lead.id, toStatus: 'Contacted' });

    messagesSent++;

    // Stagger sends with randomized delay (Req 4.6)
    if (i < leadsResult.rows.length - 1) {
      const delaySeconds = generateStaggerDelay();
      await sleep(delaySeconds * 1000);
    }
  }

  return { messagesSent };
}

/**
 * Returns true iff the elapsed time since lastMessageDate is >= cadenceIntervalDays.
 * Exported as a pure function for property testing.
 *
 * Requirements: 5.1 (Property 7)
 */
export function isFollowUpDue(
  lastMessageDate: Date,
  cadenceIntervalDays: number,
  now: Date,
): boolean {
  const elapsedMs = now.getTime() - lastMessageDate.getTime();
  const intervalMs = cadenceIntervalDays * 24 * 60 * 60 * 1000;
  return elapsedMs >= intervalMs;
}

/**
 * Returns true iff followUpCount >= maxFollowUps and the prospect has not replied.
 * Exported as a pure function for property testing.
 *
 * Requirements: 5.2, 5.5 (Property 8)
 */
export function shouldCloseNoResponse(
  followUpCount: number,
  maxFollowUps: number,
  hasReplied: boolean,
): boolean {
  return followUpCount >= maxFollowUps && !hasReplied;
}

/**
 * Execute the follow-up stage of a pipeline run.
 *
 * - Queries leads with status 'Contacted' that have not replied
 * - Checks cadence intervals against last message timestamp
 * - Generates follow-up referencing conversation thread via messageService
 * - Marks outreach as is_follow_up = true
 * - Enforces max follow-ups cap (config.maxFollowUps)
 * - Moves to Closed with reason "no_response" when max reached and no reply
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
async function executeFollowUpStage(founderId: string): Promise<StageResult> {
  const config = await getPipelineConfig(founderId);
  const strategy = extractStrategy(config);
  const now = new Date();

  // Query leads with status 'Contacted' that have outreach records (i.e. have been messaged)
  const leadsResult = await query<{
    id: string;
    name: string;
    role: string;
    company: string;
    industry: string | null;
    email: string;
    enrichment_data: EnrichmentData | null;
  }>(
    `SELECT id, name, role, company, industry, email, enrichment_data
     FROM lead
     WHERE founder_id = $1
       AND is_deleted = false
       AND crm_status = 'Contacted'
       AND email IS NOT NULL
       AND email != ''
     ORDER BY updated_at ASC`,
    [founderId],
  );

  let messagesSent = 0;

  for (const lead of leadsResult.rows) {
    // Get outreach history for this lead
    const outreachHistory = await getOutreachHistory(lead.id);
    if (outreachHistory.length === 0) continue;

    // Check if the lead has received any reply (incoming_reply table)
    const replyResult = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM incoming_reply WHERE lead_id = $1`,
      [lead.id],
    );
    const hasReplied = parseInt(replyResult.rows[0].count, 10) > 0;

    // If they've replied, skip — the inbox stage handles replies
    if (hasReplied) continue;

    // Count existing follow-ups
    const followUpCount = outreachHistory.filter((r) => r.isFollowUp).length;

    // Check if we should close this lead (max follow-ups reached, no reply)
    if (shouldCloseNoResponse(followUpCount, config.maxFollowUps, hasReplied)) {
      await changeLeadStatus({
        leadId: lead.id,
        toStatus: 'Closed',
        reason: 'no_response',
      });
      continue;
    }

    // Determine which cadence interval to use based on follow-up count
    // followUpCount 0 → first follow-up, use sequenceCadenceDays[0]
    // followUpCount 1 → second follow-up, use sequenceCadenceDays[1]
    // etc.
    const cadenceIndex = Math.min(followUpCount, config.sequenceCadenceDays.length - 1);
    const cadenceIntervalDays = config.sequenceCadenceDays[cadenceIndex];

    // Get the last message timestamp
    const lastMessage = outreachHistory[outreachHistory.length - 1];
    const lastMessageDate = lastMessage.outreachDate;

    // Check if follow-up is due based on cadence
    if (!isFollowUpDue(lastMessageDate, cadenceIntervalDays, now)) {
      continue;
    }

    // Check throttle limit before sending
    const allowed = await canRecordOutreach(founderId, 'email');
    if (!allowed) {
      break; // Throttle limit reached — stop processing
    }

    // Build conversation thread context for the follow-up prompt
    const conversationContext = outreachHistory
      .map((r) => `[${r.isFollowUp ? 'Follow-up' : 'Initial'}] ${r.messageContent}`)
      .join('\n\n');

    const strategyPrompt = formatStrategyForPrompt(strategy);

    // Generate follow-up message referencing conversation thread (Req 5.3)
    let messageResponse;
    try {
      messageResponse = await generateMessage({
        leadName: lead.name,
        leadRole: lead.role,
        leadCompany: lead.company,
        enrichmentData: lead.enrichment_data ?? undefined,
        messageType: 'cold_email',
        tone: strategy.tonePreference,
        productContext: `${strategyPrompt}\n\nPrevious conversation thread:\n${conversationContext}\n\nWrite a follow-up message that references the previous conversation.`,
      });
    } catch {
      // Message generation failed — skip this lead
      continue;
    }

    // Send via Gmail
    let gmailThreadId: string;
    let gmailMessageId: string;
    try {
      const sendResult = await sendEmail(
        founderId,
        lead.email,
        `Following up`,
        messageResponse.message,
      );
      gmailThreadId = sendResult.gmailThreadId;
      gmailMessageId = sendResult.gmailMessageId;
    } catch {
      // Send failed — skip, retry next run
      continue;
    }

    // Record outreach with is_follow_up = true (Req 5.4)
    const outreachRecord = await recordOutreach({
      leadId: lead.id,
      founderId,
      channel: 'email',
      messageContent: messageResponse.message,
      isFollowUp: true,
    });

    // Update outreach_record with gmail_thread_id and gmail_message_id
    await query(
      `UPDATE outreach_record SET gmail_thread_id = $1, gmail_message_id = $2 WHERE id = $3`,
      [gmailThreadId, gmailMessageId, outreachRecord.id],
    );

    messagesSent++;
  }

  return { messagesSent };
}

/**
 * Execute the inbox monitoring and response processing stage.
 *
 * - Polls inbox via emailIntegrationService.pollInbox using last sync timestamp or 24h ago
 * - Classifies each reply via responseClassifierService.classifyReply
 * - Handles each classification:
 *   - interested → update CRM to Replied, pass to booking agent via proposeSlots
 *   - not_interested → update CRM to Closed with reason "not_interested"
 *   - objection/question → generate contextual response, send via email
 *   - out_of_office → no action (follow-up stage will skip leads with replies)
 * - Flags low-confidence classifications for manual review (classifyReply handles this)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */
async function executeInboxStage(founderId: string): Promise<StageResult> {
  // Determine sinceTimestamp: use last sync from email connection, or 24h ago
  const emailConnection = await getEmailConnection(founderId);
  let sinceTimestamp: Date;
  if (emailConnection?.lastSyncAt) {
    sinceTimestamp = emailConnection.lastSyncAt;
  } else {
    sinceTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000);
  }

  // Poll inbox — matches replies to outreach threads automatically
  const replies = await pollInbox(founderId, sinceTimestamp);

  let repliesProcessed = 0;
  const config = await getPipelineConfig(founderId);
  const strategy = extractStrategy(config);

  for (const reply of replies) {
    // Build conversation context from outreach history
    const outreachHistory = await getOutreachHistory(reply.leadId);
    const conversationContext = outreachHistory
      .map((r) => `[${r.isFollowUp ? 'Follow-up' : 'Initial'}] ${r.messageContent}`)
      .join('\n\n');

    // Classify the reply (Req 6.1, 6.6)
    let classification;
    try {
      classification = await classifyReply(reply.id, reply.bodyText, conversationContext);
    } catch {
      // Classification failed — skip this reply, retry next run
      continue;
    }

    // Skip low-confidence classifications — already flagged for manual review by classifyReply (Req 6.7)
    if (classification.confidence < 0.7) {
      repliesProcessed++;
      continue;
    }

    // Handle each classification
    switch (classification.classification) {
      case 'interested': {
        // Update CRM to Replied (Req 6.2)
        await changeLeadStatus({ leadId: reply.leadId, toStatus: 'Replied' });
        // Pass to booking agent (Req 6.2)
        try {
          await proposeSlots(founderId, reply.leadId);
        } catch {
          // Booking proposal failed — lead is still marked Replied, booking stage can retry
        }
        break;
      }

      case 'not_interested': {
        // Update CRM to Closed with reason (Req 6.3)
        await changeLeadStatus({
          leadId: reply.leadId,
          toStatus: 'Closed',
          reason: 'not_interested',
        });
        break;
      }

      case 'objection':
      case 'question': {
        // Generate contextual response addressing the objection/question (Req 6.4)
        const strategyPrompt = formatStrategyForPrompt(strategy);

        // Get lead info for message generation
        const leadResult = await query<{
          name: string;
          role: string;
          company: string;
          email: string;
          enrichment_data: EnrichmentData | null;
        }>(`SELECT name, role, company, email, enrichment_data FROM lead WHERE id = $1`, [
          reply.leadId,
        ]);

        if (leadResult.rows.length > 0) {
          const lead = leadResult.rows[0];
          try {
            const messageResponse = await generateMessage({
              leadName: lead.name,
              leadRole: lead.role,
              leadCompany: lead.company,
              enrichmentData: lead.enrichment_data ?? undefined,
              messageType: 'cold_email',
              tone: strategy.tonePreference,
              productContext: `${strategyPrompt}\n\nThe prospect sent a ${classification.classification}:\n"${reply.bodyText}"\n\nPrevious conversation:\n${conversationContext}\n\nWrite a thoughtful response addressing their ${classification.classification}.`,
            });

            await sendEmail(founderId, lead.email, `Re: Following up`, messageResponse.message);
          } catch {
            // Message generation or send failed — skip, retry next run
          }
        }
        break;
      }

      case 'out_of_office': {
        // No action needed — follow-up stage will skip leads with replies (Req 6.5)
        break;
      }
    }

    repliesProcessed++;
  }

  return { repliesProcessed };
}

/**
 * Execute the booking stage of a pipeline run.
 *
 * - Processes interested prospects (CRM status 'Replied') that don't have an active booking proposal
 *   by creating new proposals via bookingAgentService.proposeSlots
 * - Handles proposal expiry follow-ups: proposals older than 48h with status 'proposed'
 *   that haven't had a follow-up sent yet
 * - Handles decline re-proposals for proposals with status 'declined' (handled by handleDecline
 *   which creates a new proposal automatically, but we look for declined proposals that
 *   need re-processing)
 * - Updates CRM to Booked on confirmed booking, records meeting date (handled by
 *   bookingAgentService.handleSlotConfirmation, called externally when prospect confirms)
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */
async function executeBookingStage(founderId: string): Promise<StageResult> {
  let meetingsBooked = 0;

  // 1. Process leads with CRM status 'Replied' that don't have an active booking proposal
  //    (Req 7.1, 7.2)
  const repliedLeadsResult = await query<{ id: string }>(
    `SELECT l.id
     FROM lead l
     WHERE l.founder_id = $1
       AND l.is_deleted = false
       AND l.crm_status = 'Replied'
       AND NOT EXISTS (
         SELECT 1 FROM booking_proposal bp
         WHERE bp.lead_id = l.id
           AND bp.status IN ('proposed', 'confirmed')
       )`,
    [founderId],
  );

  for (const lead of repliedLeadsResult.rows) {
    try {
      await proposeSlots(founderId, lead.id);
    } catch {
      // Proposal creation failed (e.g. no available slots, no email) — skip, retry next run
    }
  }

  // 2. Handle proposal expiry follow-ups: proposals older than 48h with status 'proposed'
  //    that haven't had a follow-up sent yet (Req 7.5)
  const expiredProposalsResult = await query<{ id: string }>(
    `SELECT id FROM booking_proposal
     WHERE founder_id = $1
       AND status = 'proposed'
       AND proposed_at < NOW() - INTERVAL '48 hours'
       AND follow_up_sent_at IS NULL`,
    [founderId],
  );

  for (const proposal of expiredProposalsResult.rows) {
    try {
      await handleProposalExpiry(proposal.id);
    } catch {
      // Expiry handling failed — skip, retry next run
    }
  }

  // 3. Handle decline re-proposals: find proposals in 'proposed' status where the lead
  //    has replied after the proposal was sent, indicating they want different times.
  //    We detect this by checking for incoming replies classified as 'objection' on leads
  //    with active proposals that were sent after the proposal date. (Req 7.6)
  const declineProposalsResult = await query<{ id: string }>(
    `SELECT DISTINCT bp.id FROM booking_proposal bp
     JOIN incoming_reply ir ON ir.lead_id = bp.lead_id
     WHERE bp.founder_id = $1
       AND bp.status = 'proposed'
       AND ir.received_at > bp.proposed_at
       AND ir.classification_result IN ('objection', 'not_interested')
       AND ir.requires_manual_review = false`,
    [founderId],
  );

  for (const proposal of declineProposalsResult.rows) {
    try {
      await handleDecline(proposal.id);
    } catch {
      // Decline re-proposal failed — skip, retry next run
    }
  }

  // 4. Count confirmed bookings from this run cycle
  //    (Confirmed proposals where the lead just moved to 'Booked' status)
  //    We count leads that are now 'Booked' and have a confirmed proposal
  const bookedCountResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM booking_proposal
     WHERE founder_id = $1
       AND status = 'confirmed'
       AND responded_at >= NOW() - INTERVAL '1 hour'`,
    [founderId],
  );
  meetingsBooked = parseInt(bookedCountResult.rows[0].count, 10);

  return { meetingsBooked };
}

// ---------------------------------------------------------------------------
// Pipeline state — persisted in pipeline_config table
// ---------------------------------------------------------------------------

/**
 * Read the pipeline state from the database.
 * Falls back to 'running' if no config exists.
 */
export async function getPipelineState(
  founderId?: string,
): Promise<'running' | 'paused' | 'error'> {
  const fid = founderId ?? '00000000-0000-0000-0000-000000000001';
  try {
    const result = await query<{ pipeline_state: string }>(
      `SELECT pipeline_state FROM pipeline_config WHERE founder_id = $1`,
      [fid],
    );
    if (result.rows.length === 0) return 'running';
    const state = result.rows[0].pipeline_state;
    if (state === 'running' || state === 'paused' || state === 'error') return state;
    return 'running';
  } catch {
    return 'running';
  }
}

/**
 * Persist the pipeline state to the database.
 */
export async function setPipelineState(
  state: 'running' | 'paused' | 'error',
  error?: string,
  founderId?: string,
): Promise<void> {
  const fid = founderId ?? '00000000-0000-0000-0000-000000000001';
  try {
    await query(
      `UPDATE pipeline_config
       SET pipeline_state = $1, pipeline_error = $2, updated_at = NOW()
       WHERE founder_id = $3`,
      [state, error ?? null, fid],
    );
  } catch (err) {
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'pipeline',
      level: 'error',
      message: `Failed to persist pipeline state: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { state, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Read the last pipeline error from the database.
 */
export async function getLastError(founderId?: string): Promise<string | undefined> {
  const fid = founderId ?? '00000000-0000-0000-0000-000000000001';
  try {
    const result = await query<{ pipeline_error: string | null }>(
      `SELECT pipeline_error FROM pipeline_config WHERE founder_id = $1`,
      [fid],
    );
    return result.rows[0]?.pipeline_error ?? undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

const STAGES = [
  'enrichment_retry',
  'discovery',
  'outreach',
  'follow_up',
  'inbox',
  'booking',
] as const;
type StageName = (typeof STAGES)[number];

const STAGE_EXECUTORS: Record<
  StageName,
  (founderId: string, projectId: string, icpProfileId?: string) => Promise<StageResult>
> = {
  enrichment_retry: executeEnrichmentRetryStage,
  discovery: executeDiscoveryStage,
  outreach: (founderId) => executeOutreachStage(founderId),
  follow_up: (founderId) => executeFollowUpStage(founderId),
  inbox: (founderId) => executeInboxStage(founderId),
  booking: executeBookingStage,
};

// ---------------------------------------------------------------------------
// executePipelineRun
// ---------------------------------------------------------------------------

/**
 * Execute a full pipeline run for a founder.
 * Creates a pipeline_run record, executes stages sequentially,
 * catches per-stage errors, and updates the run record.
 *
 * When `icpProfileId` is provided, validates the profile exists, is active,
 * and belongs to the project, then scopes discovery to that single profile.
 * When omitted, all active profiles are used (existing behavior).
 *
 * Requirements: 1.2, 1.3, 1.4, 4.1, 4.2, 4.3, 4.4, 4.5
 */
export async function executePipelineRun(
  founderId: string,
  projectId: string,
  icpProfileId?: string,
): Promise<PipelineRun> {
  // Validate icpProfileId when provided (Req 4.4)
  if (icpProfileId) {
    const profile = await getICPProfileById(icpProfileId);

    if (!profile || !profile.isActive) {
      throw Object.assign(new Error('ICP profile is inactive or does not exist'), {
        statusCode: profile ? 400 : 404,
        errorType: 'validation_error',
      });
    }

    if (profile.projectId !== projectId) {
      throw Object.assign(new Error('ICP profile does not belong to the specified project'), {
        statusCode: 400,
        errorType: 'validation_error',
      });
    }
  }

  // Detect and mark stale runs as failed (Req 7.6)
  const staleRuns = await query<{ id: string }>(
    `SELECT id FROM pipeline_run
     WHERE founder_id = $1
       AND project_id = $2
       AND status = 'running'
       AND started_at < NOW() - INTERVAL '5 minutes'`,
    [founderId, projectId],
  );

  for (const staleRun of staleRuns.rows) {
    await query(
      `UPDATE pipeline_run
       SET status = 'failed',
           stage_errors = COALESCE(stage_errors, '{}'::jsonb) || $1::jsonb,
           completed_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ _stale: 'timeout_stale_run' }), staleRun.id],
    );
    logStructured({
      timestamp: new Date().toISOString(),
      stage: 'pipeline',
      level: 'warn',
      message: `Marked stale pipeline run as failed`,
      metadata: { staleRunId: staleRun.id, reason: 'timeout_stale_run' },
    });
  }

  // Create pipeline_run record with project_id and optional icp_profile_id (Req 4.5)
  const insertResult = await query<PipelineRunRow>(
    `INSERT INTO pipeline_run (founder_id, project_id, icp_profile_id, status, started_at)
     VALUES ($1, $2, $3, 'running', NOW())
     RETURNING ${PIPELINE_RUN_COLUMNS}`,
    [founderId, projectId, icpProfileId ?? null],
  );
  const runId = insertResult.rows[0].id;

  const stagesCompleted: string[] = [];
  const stageErrors: Record<string, string> = {};
  let prospectsDiscovered = 0;
  let messagesSent = 0;
  let repliesProcessed = 0;
  let meetingsBooked = 0;
  let enrichmentsRetried = 0;

  for (const stage of STAGES) {
    try {
      const result = await STAGE_EXECUTORS[stage](founderId, projectId, icpProfileId);
      stagesCompleted.push(stage);
      prospectsDiscovered += result.prospectsDiscovered ?? 0;
      messagesSent += result.messagesSent ?? 0;
      repliesProcessed += result.repliesProcessed ?? 0;
      meetingsBooked += result.meetingsBooked ?? 0;
      enrichmentsRetried += result.enrichmentsRetried ?? 0;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stageErrors[stage] = message;
      logStructured({
        timestamp: new Date().toISOString(),
        stage,
        level: 'error',
        message: `Stage "${stage}" failed: ${message}`,
        retryEligible: true,
        metadata: { stageName: stage, error: message },
      });
    }
  }

  // Determine final status
  const hasErrors = Object.keys(stageErrors).length > 0;
  const allFailed = stagesCompleted.length === 0 && hasErrors;
  const finalStatus = allFailed ? 'failed' : hasErrors ? 'partial' : 'completed';

  // Update pipeline_run record
  const updateResult = await query<PipelineRunRow>(
    `UPDATE pipeline_run
     SET status = $1,
         stages_completed = $2,
         stage_errors = $3::jsonb,
         prospects_discovered = $4,
         messages_sent = $5,
         replies_processed = $6,
         meetings_booked = $7,
         enrichments_retried = $8,
         completed_at = NOW()
     WHERE id = $9
     RETURNING ${PIPELINE_RUN_COLUMNS}`,
    [
      finalStatus,
      stagesCompleted,
      JSON.stringify(stageErrors),
      prospectsDiscovered,
      messagesSent,
      repliesProcessed,
      meetingsBooked,
      enrichmentsRetried,
      runId,
    ],
  );

  // Log structured pipeline run summary (Req 7.5, 10.5)
  logPipelineRunSummary(runId, {
    prospectsDiscovered,
    enrichmentsCompleted: prospectsDiscovered,
    enrichmentsRetried,
    messagesSent,
    messagesFailed: 0,
    repliesProcessed,
    meetingsBooked,
  });

  if (finalStatus === 'failed') {
    await setPipelineState('error', 'All stages failed in last pipeline run', founderId);
  }

  return mapRunRow(updateResult.rows[0]);
}

// ---------------------------------------------------------------------------
// Pause / Resume
// ---------------------------------------------------------------------------

/**
 * Pause the pipeline orchestrator.
 * Stops scheduling new runs. Any in-progress run completes before halting.
 *
 * Requirements: 1.5
 */
export async function pausePipeline(founderId?: string): Promise<void> {
  await setPipelineState('paused', undefined, founderId);
}

/**
 * Resume the pipeline orchestrator.
 * Begins executing pipeline runs from the next scheduled interval.
 *
 * Requirements: 1.7
 */
export async function resumePipeline(founderId?: string): Promise<void> {
  await setPipelineState('running', undefined, founderId);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Get the current pipeline status including last run and next scheduled run.
 *
 * Requirements: 1.6
 */
export async function getPipelineStatus(founderId: string): Promise<PipelineStatus> {
  const lastRunResult = await query<PipelineRunRow>(
    `SELECT ${PIPELINE_RUN_COLUMNS} FROM pipeline_run
     WHERE founder_id = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [founderId],
  );

  const lastRun = lastRunResult.rows.length > 0 ? mapRunRow(lastRunResult.rows[0]) : undefined;

  // Check if there's an active (in-progress) pipeline run
  const activeRunResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM pipeline_run
     WHERE founder_id = $1 AND status = 'running'`,
    [founderId],
  );
  const hasActiveRun = parseInt(activeRunResult.rows[0]?.count ?? '0', 10) > 0;

  const currentState = await getPipelineState(founderId);

  let nextRunAt: Date | undefined;
  if (currentState === 'running' && !hasActiveRun && lastRun?.completedAt) {
    const config = await getPipelineConfig(founderId);
    nextRunAt = computeNextRunTime(config, lastRun.completedAt);
  }

  return {
    state: currentState,
    hasActiveRun,
    lastRun,
    nextRunAt,
  };
}

// ---------------------------------------------------------------------------
// Recent runs
// ---------------------------------------------------------------------------

/**
 * List recent pipeline runs for a founder.
 */
export async function getRecentRuns(founderId: string, limit = 20): Promise<PipelineRun[]> {
  const result = await query<PipelineRunRow>(
    `SELECT ${PIPELINE_RUN_COLUMNS} FROM pipeline_run
     WHERE founder_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [founderId, limit],
  );
  return result.rows.map(mapRunRow);
}

// ---------------------------------------------------------------------------
// computeNextRunTime — PURE FUNCTION (exported for property testing)
// ---------------------------------------------------------------------------

/**
 * Compute the next valid pipeline run time given a config and the last run time.
 *
 * Rules:
 * - Next run is at least `config.runIntervalMinutes` after `lastRunTime`
 * - Must fall within business hours [businessHoursStart, businessHoursEnd)
 * - Must fall on a business day (config.businessDays, 0=Sun..6=Sat)
 * - If the candidate time is outside business hours, advance to the start
 *   of the next business-hours window on a business day
 *
 * This is a pure function with no side effects.
 *
 * Requirements: 1.1
 */
export function computeNextRunTime(config: PipelineConfig, lastRunTime: Date): Date {
  const { runIntervalMinutes, businessHoursStart, businessHoursEnd, businessDays } = config;

  const [startHour, startMinute] = businessHoursStart.split(':').map(Number);
  const [endHour, endMinute] = businessHoursEnd.split(':').map(Number);

  // Candidate = lastRunTime + interval
  const candidate = new Date(lastRunTime.getTime() + runIntervalMinutes * 60 * 1000);

  // Helper: get minutes-since-midnight for a date
  const minutesOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();

  const bhStart = startHour * 60 + startMinute;
  const bhEnd = endHour * 60 + endMinute;

  // Helper: check if a day-of-week is a business day
  const isBusinessDay = (d: Date): boolean => businessDays.includes(d.getDay());

  // Helper: set time to business hours start on a given date
  const setToBusinessStart = (d: Date): Date => {
    const result = new Date(d);
    result.setHours(startHour, startMinute, 0, 0);
    return result;
  };

  // Helper: advance to next business day (starting from given date)
  const advanceToNextBusinessDay = (d: Date): Date => {
    const result = new Date(d);
    // Move to next day and keep checking
    for (let i = 0; i < 8; i++) {
      result.setDate(result.getDate() + 1);
      if (isBusinessDay(result)) {
        return setToBusinessStart(result);
      }
    }
    // Fallback: should not happen with valid config
    return setToBusinessStart(result);
  };

  let next = new Date(candidate);

  // If not a business day, advance to next business day start
  if (!isBusinessDay(next)) {
    return advanceToNextBusinessDay(next);
  }

  const mins = minutesOfDay(next);

  // If before business hours, snap to business hours start same day
  if (mins < bhStart) {
    return setToBusinessStart(next);
  }

  // If at or after business hours end, advance to next business day start
  if (mins >= bhEnd) {
    return advanceToNextBusinessDay(next);
  }

  // Within business hours on a business day — use as-is
  return next;
}
