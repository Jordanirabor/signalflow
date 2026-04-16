import { scoreAndStoreCorrelation } from '@/services/correlationEngineService';
import { getActiveProfiles } from '@/services/icpProfileService';
import { getEnrichedICP } from '@/services/icpService';
import { createLead, updateLeadEnrichment, type CreateLeadInput } from '@/services/leadService';
import { getPipelineConfig } from '@/services/pipelineConfigService';
import { getResearchProfile } from '@/services/prospectResearcherService';
import { calculateLeadScoreV2 } from '@/services/scoringService';
import type { EnrichmentData, ICP, Lead, ResearchProfile } from '@/types';

// Real Discovery Engine and Enrichment Pipeline imports
import {
  discoverLeadsMultiICP,
  discoverLeads as discoveryEngineDiscover,
} from './discovery/discoveryEngine';
import { enrichProspect } from './discovery/enrichmentPipeline';
import { createRunCache } from './discovery/runCache';
import type { ProspectContext, RunCache } from './discovery/types';

// ---------------------------------------------------------------------------
// Enrichment Source Interface — kept for backward compatibility
// ---------------------------------------------------------------------------

export interface EnrichmentSource {
  name: string;
  fetch(leadName: string, company: string): Promise<Partial<EnrichmentData>>;
}

export interface EnrichmentResult {
  enrichmentData: EnrichmentData;
  enrichmentStatus: 'complete' | 'partial' | 'pending';
}

export interface DiscoveredLeadData {
  // Existing fields
  name: string;
  role: string;
  company: string;
  industry?: string;
  geography?: string;

  // New fields
  discoverySource?: string;
  linkedinUrl?: string;
  companyDomain?: string;
  twitterHandle?: string;
  githubUsername?: string;
}

// ---------------------------------------------------------------------------
// Mock enrichment sources — kept exported for backward compatibility
// ---------------------------------------------------------------------------

export const linkedinSource: EnrichmentSource = {
  name: 'linkedin',
  async fetch(leadName: string, _company: string): Promise<Partial<EnrichmentData>> {
    return {
      linkedinBio: `${leadName} is an experienced professional with a strong background in technology and leadership.`,
    };
  },
};

export const recentPostsSource: EnrichmentSource = {
  name: 'recentPosts',
  async fetch(leadName: string, _company: string): Promise<Partial<EnrichmentData>> {
    return {
      recentPosts: [
        `${leadName} shared insights on industry trends`,
        `${leadName} discussed product-market fit strategies`,
      ],
    };
  },
};

export const companyInfoSource: EnrichmentSource = {
  name: 'companyInfo',
  async fetch(_leadName: string, company: string): Promise<Partial<EnrichmentData>> {
    return {
      companyInfo: `${company} is a growing company in the technology sector focused on innovative solutions.`,
    };
  },
};

// ---------------------------------------------------------------------------
// Module-level RunCache for sharing across enrichLead calls within a pipeline run
// ---------------------------------------------------------------------------

let activeRunCache: RunCache | null = null;

// ---------------------------------------------------------------------------
// Lead Discovery — delegates to the real Discovery Engine
// ---------------------------------------------------------------------------

/**
 * Discover leads matching the given ICP using the proprietary Discovery Engine.
 * Calls the Discovery Engine which coordinates all enabled source adapters,
 * generates AI-powered queries, and deduplicates results.
 *
 * Note: This function is async (changed from sync mock) since it calls
 * the async Discovery Engine.
 */
export async function discoverLeads(icp: ICP): Promise<DiscoveredLeadData[]> {
  return discoveryEngineDiscover(icp);
}

// ---------------------------------------------------------------------------
// Enrichment Pipeline — delegates to the real Enrichment Pipeline
// ---------------------------------------------------------------------------

/**
 * Enrich a lead using the proprietary Enrichment Pipeline.
 * Executes all enabled enrichment source adapters concurrently,
 * merges results, discovers email, and scores confidence.
 *
 * Maintains the same function signature for backward compatibility.
 * The optional `sources` parameter is ignored — the real pipeline
 * uses its own set of source adapters.
 */
export async function enrichLead(
  leadName: string,
  company: string,
  _sources?: EnrichmentSource[],
): Promise<EnrichmentResult> {
  const cache = activeRunCache ?? createRunCache();

  const prospect: ProspectContext = {
    name: leadName,
    company,
  };

  const result = await enrichProspect(prospect, cache);

  return {
    enrichmentData: result.enrichmentData as EnrichmentData,
    enrichmentStatus: result.enrichmentStatus,
  };
}

// ---------------------------------------------------------------------------
// Full Discovery + Enrichment Pipeline
// ---------------------------------------------------------------------------

/**
 * Discover leads for a founder, create them in the database with scoring,
 * then enrich each lead and update their enrichment data + re-score.
 *
 * Uses multi-ICP discovery: fetches all active profiles, discovers across
 * all profiles with global cap enforcement, and associates each lead with
 * the best-matching ICP profile.
 *
 * Creates a RunCache at the start and clears it after all prospects are processed.
 */
export async function discoverAndEnrichLeads(founderId: string): Promise<Lead[]> {
  // Fetch all active ICP profiles
  const activeProfiles = await getActiveProfiles(founderId);
  if (activeProfiles.length === 0) {
    throw new Error('No active ICP profiles defined for this founder');
  }

  // Get pipeline config for daily cap
  const config = await getPipelineConfig(founderId);

  // Initialize RunCache for this pipeline run
  const runCache = createRunCache();
  activeRunCache = runCache;

  // Build a lookup map for profiles
  const profileMap = new Map(activeProfiles.map((p) => [p.id, p]));

  try {
    // Discover prospects across all active ICP profiles
    const discoveryResult = await discoverLeadsMultiICP(activeProfiles, config.dailyDiscoveryCap);
    const results: Lead[] = [];

    for (const prospect of discoveryResult.prospects) {
      // Look up the originating ICPProfile
      const originatingProfile = profileMap.get(prospect.icpProfileId);
      if (!originatingProfile) continue;

      // Score the lead using V2 scoring with the originating ICPProfile
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

      const input: CreateLeadInput = {
        founderId,
        name: prospect.name,
        role: prospect.role,
        company: prospect.company,
        industry: prospect.industry,
        geography: prospect.geography,
        icpProfileId: prospect.icpProfileId,
      };

      let lead: Lead;
      try {
        lead = await createLead(input, scoreResult.totalScore, scoreResult.breakdown);
      } catch {
        // Skip duplicates or other creation errors
        continue;
      }

      // Enrich the lead
      const enrichResult = await enrichLead(lead.name, lead.company);

      // Update enrichment data and re-score using the originating ICPProfile
      const updatedLead = await updateLeadEnrichment(
        lead.id,
        enrichResult.enrichmentData,
        enrichResult.enrichmentStatus,
        originatingProfile,
      );

      const finalLead = updatedLead ?? lead;

      // Trigger correlation scoring after enrichment completes (Req 3.1)
      try {
        const enrichedICP = await getEnrichedICP(founderId);
        if (enrichedICP) {
          const researchProfile: ResearchProfile = (await getResearchProfile(finalLead.id)) ?? {
            leadId: finalLead.id,
            topicsOfInterest: [],
            currentChallenges: [],
            recentActivity: [],
            publishedContentSummaries: [],
            overallSentiment: 'neutral',
            sourcesUsed: [],
            sourcesUnavailable: [],
            researchedAt: new Date(),
          };
          await scoreAndStoreCorrelation(finalLead, researchProfile, enrichedICP);
        }
      } catch (error) {
        console.error(
          `[EnrichmentService] Correlation scoring failed for "${finalLead.name}":`,
          error instanceof Error ? error.message : String(error),
        );
      }

      results.push(finalLead);
    }

    return results;
  } finally {
    // Clear RunCache after all prospects are processed
    runCache.clear();
    activeRunCache = null;
  }
}
