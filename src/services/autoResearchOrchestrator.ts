// ============================================================
// Auto-Research Orchestrator
// ============================================================
//
// Coordinates the research-then-generate workflow for manual leads.
// Checks for existing Research Profiles, triggers research if missing
// or stale, builds PersonalizationContext, and generates the message.
//
// Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
// ============================================================

import type {
  AutoResearchProgress,
  EnhancedMessageResponse,
  EnrichedICP,
  Lead,
  MessageRequest,
  ResearchProfile,
} from '@/types';

import { generateEnhancedMessage } from './messageService';
import { buildPersonalizationContext } from './personalizationContextBuilder';
import { getResearchProfile, isResearchStale, researchProspect } from './prospectResearcherService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Overall timeout for the combined research + generation workflow (180s). */
const TOTAL_TIMEOUT_MS = 180_000;

/** Research profiles older than this are considered stale. */
const STALE_THRESHOLD_DAYS = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoResearchResult {
  researchProfile: ResearchProfile;
  message: EnhancedMessageResponse;
  researchWasRefreshed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reportProgress(
  onProgress: ((progress: AutoResearchProgress) => void) | undefined,
  stage: AutoResearchProgress['stage'],
  percentComplete: number,
  message: string,
): void {
  if (onProgress) {
    onProgress({ stage, percentComplete, message });
  }
}
/**
 * Create a promise that rejects after the specified timeout.
 */
function createTimeout(ms: number): { promise: Promise<never>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Auto-research workflow timed out after ${ms}ms`));
    }, ms);
  });
  return {
    promise,
    clear: () => clearTimeout(timer),
  };
}

// ---------------------------------------------------------------------------
// Staleness Check
// ---------------------------------------------------------------------------

/**
 * Returns true when the Research Profile is older than 7 days.
 *
 * Requirements: 5.7
 */
export function shouldRefreshResearch(profile: ResearchProfile): boolean {
  return isResearchStale(profile, STALE_THRESHOLD_DAYS);
}

// ---------------------------------------------------------------------------
// Core Workflow
// ---------------------------------------------------------------------------

/**
 * Coordinate the full research-then-generate workflow.
 *
 * 1. Check if the lead already has a fresh Research Profile.
 * 2. If missing or stale (>7 days), trigger the Prospect Researcher.
 * 3. Report progress through the optional callback.
 * 4. Build PersonalizationContext and generate the message.
 * 5. Enforce a 180-second total timeout.
 * 6. On complete research failure, fall back to Enriched ICP + basic lead info.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
export async function researchAndGenerate(
  lead: Lead,
  messageRequest: MessageRequest,
  enrichedICP: EnrichedICP,
  onProgress?: (progress: AutoResearchProgress) => void,
): Promise<AutoResearchResult> {
  const timeout = createTimeout(TOTAL_TIMEOUT_MS);

  try {
    const result = await Promise.race([
      executeWorkflow(lead, messageRequest, enrichedICP, onProgress),
      timeout.promise,
    ]);
    return result;
  } catch (error) {
    // On timeout or unexpected error, attempt fallback generation
    reportProgress(onProgress, 'failed', 0, 'Research failed, generating with limited data');

    try {
      const fallbackMessage = await generateFallbackMessage(lead, messageRequest, enrichedICP);
      const emptyProfile = buildEmptyResearchProfile(lead.id);
      return {
        researchProfile: emptyProfile,
        message: fallbackMessage,
        researchWasRefreshed: false,
      };
    } catch (fallbackError) {
      reportProgress(onProgress, 'failed', 0, 'Message generation failed');
      throw fallbackError;
    }
  } finally {
    timeout.clear();
  }
}
/**
 * Internal workflow logic — separated from timeout handling for clarity.
 */
async function executeWorkflow(
  lead: Lead,
  messageRequest: MessageRequest,
  enrichedICP: EnrichedICP,
  onProgress?: (progress: AutoResearchProgress) => void,
): Promise<AutoResearchResult> {
  let researchProfile: ResearchProfile | null = null;
  let researchWasRefreshed = false;

  // --- Step 1: Check for existing Research Profile ---
  try {
    researchProfile = await getResearchProfile(lead.id);
  } catch {
    // DB read failure — treat as missing profile
    researchProfile = null;
  }

  // --- Step 2: Research if missing or stale ---
  const needsResearch = !researchProfile || shouldRefreshResearch(researchProfile);

  if (needsResearch) {
    researchWasRefreshed = true;

    try {
      reportProgress(onProgress, 'researching_linkedin', 10, 'Researching LinkedIn...');
      reportProgress(onProgress, 'researching_twitter', 25, 'Researching Twitter...');
      reportProgress(onProgress, 'researching_blogs', 40, 'Researching blogs and publications...');

      // Execute the full research pipeline (adapters run concurrently inside)
      researchProfile = await researchProspect(lead);

      reportProgress(onProgress, 'analyzing_content', 60, 'Analyzing research content...');
    } catch {
      // Complete research failure — fall back to limited personalization
      console.error(
        `[AutoResearchOrchestrator] Research failed for lead "${lead.name}", falling back to limited personalization`,
      );
      researchProfile = null;
    }
  }

  // --- Step 3: Generate message ---
  reportProgress(onProgress, 'generating_message', 80, 'Generating personalized message...');

  let message: EnhancedMessageResponse;

  if (researchProfile) {
    // Build full PersonalizationContext and generate enhanced message
    const personalizationContext = await buildPersonalizationContext(enrichedICP, researchProfile);

    message = await generateEnhancedMessage({
      leadName: lead.name,
      leadRole: lead.role,
      leadCompany: lead.company,
      enrichmentData: lead.enrichmentData,
      messageType: messageRequest.messageType,
      tone: messageRequest.tone,
      productContext: messageRequest.productContext,
      personalizationContext,
    });
  } else {
    // Fallback: generate with Enriched ICP + basic lead info only
    message = await generateFallbackMessage(lead, messageRequest, enrichedICP);
    researchProfile = buildEmptyResearchProfile(lead.id);
  }

  reportProgress(onProgress, 'complete', 100, 'Message generation complete');

  return {
    researchProfile,
    message,
    researchWasRefreshed,
  };
}

// ---------------------------------------------------------------------------
// Fallback Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a message using only Enriched ICP + basic lead info (no research).
 * Sets `limitedPersonalization: true`.
 */
async function generateFallbackMessage(
  lead: Lead,
  messageRequest: MessageRequest,
  enrichedICP: EnrichedICP,
): Promise<EnhancedMessageResponse> {
  return generateEnhancedMessage({
    leadName: lead.name,
    leadRole: lead.role,
    leadCompany: lead.company,
    enrichmentData: lead.enrichmentData,
    messageType: messageRequest.messageType,
    tone: messageRequest.tone,
    productContext: messageRequest.productContext,
    // No personalizationContext → triggers limitedPersonalization path
  });
}

/**
 * Build an empty Research Profile for fallback scenarios.
 */
function buildEmptyResearchProfile(leadId: string): ResearchProfile {
  return {
    leadId,
    topicsOfInterest: [],
    currentChallenges: [],
    recentActivity: [],
    publishedContentSummaries: [],
    overallSentiment: 'neutral',
    sourcesUsed: [],
    sourcesUnavailable: [],
    researchedAt: new Date(),
  };
}
