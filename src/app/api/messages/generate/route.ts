import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { researchAndGenerate } from '@/services/autoResearchOrchestrator';
import { getEnrichedICP } from '@/services/icpService';
import { getLeadById } from '@/services/leadService';
import {
  generateEnhancedMessage,
  generateMessage,
  type GenerateMessageInput,
} from '@/services/messageService';
import { buildPersonalizationContext } from '@/services/personalizationContextBuilder';
import { getResearchProfile } from '@/services/prospectResearcherService';
import type { ApiError, EnrichedICP, MessageRequest, ResearchProfile } from '@/types';
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
  if (!body.tone || !['professional', 'casual', 'direct'].includes(body.tone)) {
    return validationError('tone must be "professional", "casual", or "direct"', {
      tone: 'invalid',
    });
  }
  if (
    !body.productContext ||
    typeof body.productContext !== 'string' ||
    body.productContext.trim() === ''
  ) {
    return validationError('productContext is required', { productContext: 'missing' });
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
        const result = await researchAndGenerate(lead, body, enrichedICP);
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
          productContext: body.productContext.trim(),
          personalizationContext,
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
    productContext: body.productContext.trim(),
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
