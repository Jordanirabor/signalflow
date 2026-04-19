import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { researchAndGenerate } from '@/services/autoResearchOrchestrator';
import { getProviderConnectionStatus } from '@/services/emailTransportService';
import { getProjectById } from '@/services/icpProjectService';
import { getEnrichedICP } from '@/services/icpService';
import { getCallNotes } from '@/services/insightService';
import { getLeadById } from '@/services/leadService';
import {
  generateEnhancedMessage,
  generateMessage,
  type GenerateMessageInput,
} from '@/services/messageService';
import { buildPersonalizationContext } from '@/services/personalizationContextBuilder';
import { getPipelineConfig } from '@/services/pipelineConfigService';
import { getResearchProfile } from '@/services/prospectResearcherService';
import type { ApiError, CallNote, EnrichedICP, MessageRequest, ResearchProfile } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/messages/generate
 * Generate a personalized outreach message for a lead using OpenAI.
 * Auto-triggers research when no Research Profile exists and returns
 * personalization metadata alongside the message.
 *
 * Falls back to existing generation when no enriched data is available.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 5.1, 5.4
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: MessageRequest;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  // Validate required fields
  if (!body.leadId || typeof body.leadId !== 'string' || body.leadId.trim() === '') {
    return validationError('leadId is required', { leadId: 'missing' });
  }
  if (!body.messageType || !['cold_email', 'cold_dm'].includes(body.messageType)) {
    return validationError('messageType must be "cold_email" or "cold_dm"', {
      messageType: 'invalid',
    });
  }
  if (!body.tone || !['warm', 'professional', 'casual', 'direct', 'bold'].includes(body.tone)) {
    return validationError('tone must be "warm", "professional", "casual", "direct", or "bold"', {
      tone: 'invalid',
    });
  }

  // Fetch the lead
  let lead;
  try {
    lead = await getLeadById(body.leadId);
  } catch {
    return dbWriteError('Failed to retrieve lead');
  }

  if (!lead) {
    return validationError('Lead not found', { leadId: 'not_found' });
  }

  // Resolve productContext: body > lead's project description > pipeline_config fallback
  let productContext = body.productContext?.trim() || '';
  let globalSteering = '';
  if (!productContext && lead.projectId) {
    try {
      const project = await getProjectById(lead.projectId);
      if (project?.productDescription) {
        productContext = project.productDescription;
      }
    } catch {
      // Fall through to pipeline_config fallback
    }
  }
  if (!productContext || !globalSteering) {
    try {
      const config = await getPipelineConfig(session.founderId);
      if (!productContext && config.productContext) {
        productContext = config.productContext;
      }
      if (config.globalSteering) {
        globalSteering = config.globalSteering;
      }
    } catch {
      // No fallback available
    }
  }
  if (!productContext) {
    return validationError('productContext is required', { productContext: 'missing' });
  }

  // Load per-lead steering context from the lead record
  const steeringContext = lead.steeringContext || '';

  // Load call notes for the lead
  let callNotes: CallNote[] = [];
  try {
    callNotes = await getCallNotes(lead.id);
  } catch {
    // Continue without call notes — log warning in production
  }

  // --- Fetch sender name and signature from email settings ---
  let senderName: string | undefined;
  let emailSignature: string | undefined;
  try {
    const emailStatus = await getProviderConnectionStatus(session.founderId);
    if (emailStatus.sendingName) {
      senderName = emailStatus.sendingName;
    }
    if (emailStatus.emailSignature) {
      emailSignature = emailStatus.emailSignature;
    }
  } catch {
    // No email settings — sender name/signature will be omitted
  }

  // --- Attempt enriched personalization path ---
  let enrichedICP: EnrichedICP | null = null;
  let researchProfile: ResearchProfile | null = null;

  try {
    enrichedICP = await getEnrichedICP(session.founderId);
  } catch {
    // Enriched ICP fetch failed — continue with fallback
    enrichedICP = null;
  }

  // Only attempt research-based personalization if we have an Enriched ICP
  if (enrichedICP) {
    // Check for existing Research Profile
    try {
      researchProfile = await getResearchProfile(lead.id);
    } catch {
      researchProfile = null;
    }

    // If no Research Profile, trigger auto-research via the orchestrator
    if (!researchProfile) {
      try {
        const result = await researchAndGenerate(lead, body, enrichedICP, undefined, senderName);
        return NextResponse.json(result.message);
      } catch {
        // Auto-research failed entirely — fall through to enriched or basic generation
        researchProfile = null;
      }
    }

    // Research Profile exists — build PersonalizationContext and generate enhanced message
    if (researchProfile) {
      try {
        const personalizationContext = await buildPersonalizationContext(
          enrichedICP,
          researchProfile,
        );

        const result = await generateEnhancedMessage({
          leadName: lead.name,
          leadRole: lead.role,
          leadCompany: lead.company,
          enrichmentData: lead.enrichmentData,
          messageType: body.messageType,
          tone: body.tone,
          productContext,
          personalizationContext,
          senderName,
          emailSignature,
          globalSteering,
          steeringContext,
          callNotes,
        });

        return NextResponse.json(result);
      } catch (err: unknown) {
        const code = (err as Error & { code?: string })?.code;
        if (code === 'LLM_UNAVAILABLE') {
          const errorBody: ApiError = {
            error: 'LLM_UNAVAILABLE',
            message:
              'The AI message generator is currently unavailable. Please write your message manually.',
          };
          return NextResponse.json(errorBody, { status: 503 });
        }
        // Enhanced generation failed — fall through to basic generation
      }
    }
  }

  // --- Fallback: existing basic generation ---
  const input: GenerateMessageInput = {
    leadName: lead.name,
    leadRole: lead.role,
    leadCompany: lead.company,
    enrichmentData: lead.enrichmentData,
    messageType: body.messageType,
    tone: body.tone,
    productContext,
    senderName,
    emailSignature,
    painPoints: enrichedICP?.painPointsSolved,
    globalSteering,
    steeringContext,
    callNotes,
  };

  try {
    const result = await generateMessage(input);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const code = (err as Error & { code?: string })?.code;
    if (code === 'LLM_UNAVAILABLE') {
      const errorBody: ApiError = {
        error: 'LLM_UNAVAILABLE',
        message:
          'The AI message generator is currently unavailable. Please write your message manually.',
      };
      return NextResponse.json(errorBody, { status: 503 });
    }
    return dbWriteError('Failed to generate message');
  }
}
