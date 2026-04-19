import { getLeadById } from '@/services/leadService';
import { buildPersonalizationContext } from '@/services/personalizationContextBuilder';
import { getResearchProfile, researchProspect } from '@/services/prospectResearcherService';
import type {
  CallNote,
  ContentSummary,
  EnhancedMessageResponse,
  EnrichmentData,
  MessageResponse,
  MessageType,
  PersonalizationContext,
  PersonalizationMetadata,
  ResearchProfile,
  TonePreference,
} from '@/types';
import OpenAI from 'openai';
import type { ExtendedEnrichmentData } from './discovery/types';

// ---------------------------------------------------------------------------
// Tone modifiers
// ---------------------------------------------------------------------------

export const TONE_MODIFIERS: Record<TonePreference, string> = {
  warm: 'Write like a thoughtful person reaching out to someone whose work they genuinely respect. Warm, specific, human. Use contractions. Be personal but not sycophantic.',
  professional:
    'Write in a formal, business-appropriate tone. Use complete sentences without contractions. Be respectful and polished. Maintain professional distance while being personable.',
  casual:
    'Write like you are texting a peer. Keep it short, conversational, and relaxed. Use contractions freely. Skip formalities. Get to the point quickly.',
  direct:
    'Skip all pleasantries and small talk. Lead with the value proposition immediately. Be blunt and concise. Every sentence must deliver information or make an ask. No filler.',
  bold: 'Write with confidence and a slight edge. Use pattern-interrupt techniques — open with a surprising observation or a provocative question. Be assertive, not aggressive. Challenge assumptions.',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateMessageInput {
  leadName: string;
  leadRole: string;
  leadCompany: string;
  enrichmentData?: EnrichmentData;
  messageType: MessageType;
  tone: TonePreference;
  productContext: string;
  projectName?: string;
  senderName?: string;
  emailSignature?: string;
  painPoints?: string[];
  steeringContext?: string;
  globalSteering?: string;
  callNotes?: CallNote[];
}

export interface EnhancedGenerateMessageInput extends GenerateMessageInput {
  personalizationContext?: PersonalizationContext;
}

// ---------------------------------------------------------------------------
// Personalization helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether enrichment data has any usable content for personalization.
 * Returns true when ALL sources lack usable content.
 */
export function isLimitedPersonalization(data?: EnrichmentData): boolean {
  if (!data) return true;

  const hasBio = !!data.linkedinBio && data.linkedinBio.trim().length > 0;
  const hasPosts =
    Array.isArray(data.recentPosts) &&
    data.recentPosts.length > 0 &&
    data.recentPosts.some((p) => p.trim().length > 0);
  const hasCompanyInfo = !!data.companyInfo && data.companyInfo.trim().length > 0;

  return !hasBio && !hasPosts && !hasCompanyInfo;
}

/**
 * Check if enrichment data + research profile contain ≥ 2 non-empty
 * personalization-worthy data points.
 *
 * Data points checked:
 * 1. linkedinBio (non-empty string) — from enrichment data
 * 2. recentPosts (non-empty array) — from enrichment data
 * 3. companyInfo (non-empty string) — from enrichment data
 * 4. topicsOfInterest (non-empty array) — from research profile
 * 5. currentChallenges (non-empty array) — from research profile
 *
 * Requirements: 6.1, 6.2
 */
export function hasSufficientPersonalization(
  enrichmentData?: EnrichmentData | Partial<ExtendedEnrichmentData>,
  researchProfile?: ResearchProfile,
): boolean {
  let count = 0;

  // Enrichment data points
  if (enrichmentData) {
    if (enrichmentData.linkedinBio && enrichmentData.linkedinBio.trim().length > 0) {
      count++;
    }
    if (Array.isArray(enrichmentData.recentPosts) && enrichmentData.recentPosts.length > 0) {
      count++;
    }
    if (enrichmentData.companyInfo && enrichmentData.companyInfo.trim().length > 0) {
      count++;
    }
  }

  // Research profile data points
  if (researchProfile) {
    if (
      Array.isArray(researchProfile.topicsOfInterest) &&
      researchProfile.topicsOfInterest.length > 0
    ) {
      count++;
    }
    if (
      Array.isArray(researchProfile.currentChallenges) &&
      researchProfile.currentChallenges.length > 0
    ) {
      count++;
    }
  }

  return count >= 2;
}

/**
 * Collect personalization details from enrichment data for prompt construction.
 */
export function collectPersonalizationDetails(data?: EnrichmentData): string[] {
  const details: string[] = [];
  if (!data) return details;

  if (data.linkedinBio && data.linkedinBio.trim().length > 0) {
    details.push(`LinkedIn bio: ${data.linkedinBio.trim()}`);
  }
  if (
    Array.isArray(data.recentPosts) &&
    data.recentPosts.length > 0 &&
    data.recentPosts.some((p) => p.trim().length > 0)
  ) {
    const posts = data.recentPosts.filter((p) => p.trim().length > 0);
    details.push(`Recent posts: ${posts.join('; ')}`);
  }
  if (data.companyInfo && data.companyInfo.trim().length > 0) {
    details.push(`Company info: ${data.companyInfo.trim()}`);
  }

  return details;
}

// ---------------------------------------------------------------------------
// Word count enforcement
// ---------------------------------------------------------------------------

const WORD_LIMITS: Record<MessageType, number> = {
  cold_dm: 150,
  cold_email: 250,
};

export function getWordLimit(messageType: MessageType): number {
  return WORD_LIMITS[messageType];
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Truncate a message to the word limit if it exceeds it.
 */
export function enforceWordLimit(text: string, messageType: MessageType): string {
  // Strip em dashes — replace with comma or period depending on context
  const cleaned = text.replace(/\s*—\s*/g, ', ').replace(/,\s*,/g, ',');
  const limit = getWordLimit(messageType);
  const words = cleaned
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length <= limit) return cleaned.trim();
  return words.slice(0, limit).join(' ');
}

// ---------------------------------------------------------------------------
// Cold Outreach Bible — core principles for message generation
// ---------------------------------------------------------------------------

const COLD_OUTREACH_BIBLE = `Write an outreach email following this structure:

Hi [First name],

PARAGRAPH 1 (HOOK): Reference something specific about their work that shows genuine familiarity. Not generic praise. A real detail only they would recognize.

PARAGRAPH 2 (YOUR OFFER): Introduce what you're reaching out about. Be clear and concise. This could be a product, a film, a book, a service, a collaboration, anything. Describe it vividly in 1-2 sentences.

PARAGRAPH 3 (THE CONNECTION): Explain why this is relevant to THEM specifically. Connect your offer to their work, interests, or audience. Make them see the fit.

PARAGRAPH 4 (THE ASK): A soft, respectful ask. Give them options for how to engage (screener link, one-pager, quick call, whatever fits). Make it easy to say yes.

CLOSING: A warm one-liner like "Thank you for the care you bring to this work." Then sign off with "Warm regards," followed by the sender's name.

CRITICAL — DO NOT FABRICATE:
- ONLY reference content explicitly provided in the data below.
- If no specific content is provided, reference their role, company, or known work instead.
- NEVER fake a hook. If you don't have details, be direct about why you're reaching out.
- NEVER use em dashes. Use commas, periods, or restructure.

Output ONLY the message. No subject line. No commentary.`;

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildPrompt(input: GenerateMessageInput): string {
  const {
    leadName,
    leadRole,
    leadCompany,
    enrichmentData,
    messageType,
    tone,
    productContext,
    projectName,
    senderName,
  } = input;

  const typeLabel = messageType === 'cold_dm' ? 'cold DM' : 'cold email';
  const wordLimit = getWordLimit(messageType);
  const personalizationDetails = collectPersonalizationDetails(enrichmentData);

  let personalizationSection: string;
  if (personalizationDetails.length > 0) {
    personalizationSection = `Use the following enrichment details to personalize the message. Reference at least one specific detail:\n${personalizationDetails.map((d) => `- ${d}`).join('\n')}`;
  } else {
    personalizationSection =
      'No enrichment data is available. Write a generic but relevant message based on the lead role and company.';
  }

  const projectSection = projectName ? `Project: ${projectName}\n\n` : '';
  const signOff = input.emailSignature
    ? `Use this EXACT sign-off (do not modify it):\n${input.emailSignature}`
    : senderName
      ? `Sign off with: "Warm regards,\n${senderName}"`
      : 'Sign off with "Warm regards," followed by the sender\'s first name. If unknown, just use "Warm regards."';

  const painPointSection = input.painPoints?.length
    ? `Key challenges (tie these into the message — connect the prospect's likely challenges to what you're offering):\n${input.painPoints.map((p) => `- ${p}`).join('\n')}`
    : '';

  const globalSteeringSection = input.globalSteering
    ? `\nGLOBAL STEERING (apply to all messages unless overridden by per-lead steering):\n${input.globalSteering}`
    : '';
  const steeringSection = input.steeringContext
    ? `\nPER-LEAD STEERING (high priority — follow these instructions for this specific lead):\n${input.steeringContext}`
    : '';

  const callNotesSection =
    input.callNotes && input.callNotes.length > 0
      ? `\nCALL NOTES & INSIGHTS:\n${input.callNotes
          .map(
            (cn) =>
              `- Pain points: ${cn.painPoints.join(', ')}\n  Objections: ${cn.objections.join(', ')}\n  Sentiment: ${cn.sentiment}`,
          )
          .join('\n')}`
      : '';

  return `${COLD_OUTREACH_BIBLE}

---

Write a ${typeLabel} to ${leadName}, who is a ${leadRole} at ${leadCompany}.
Tone: ${tone}. Word limit: ${wordLimit} words max.
${projectSection ? `Project: ${projectName}\n` : ''}What you're offering: ${productContext}

${personalizationSection}

${painPointSection}
${globalSteeringSection}
${steeringSection}
${callNotesSection}

${signOff}

Output ONLY the message text. No subject line. No "Subject:" prefix. No commentary.`;
}

// ---------------------------------------------------------------------------
// Subject line generation
// ---------------------------------------------------------------------------

/**
 * Generate a subject line for a cold email based on the prospect and product.
 * Follows the Cold Outreach Bible: specific enough that only one person could have received it.
 */
function generateSubjectLine(leadName: string, leadCompany: string, leadRole: string): string {
  // Build a simple, specific subject from available data
  const firstName = leadName.split(/\s+/)[0];
  if (leadCompany && leadCompany.trim()) {
    return `${firstName} + ${leadCompany.trim()}`;
  }
  if (leadRole && leadRole.trim()) {
    return `Quick question, ${firstName}`;
  }
  return `Quick question, ${firstName}`;
}

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton)
// ---------------------------------------------------------------------------

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/** Exposed for testing — allows injecting a mock client. */
export function setOpenAIClient(client: OpenAI | null): void {
  openaiClient = client;
}

// ---------------------------------------------------------------------------
// Message generation
// ---------------------------------------------------------------------------

/**
 * Generate a personalized outreach message using OpenAI.
 * Throws an error with code 'LLM_UNAVAILABLE' if the LLM call fails.
 */
export async function generateMessage(input: GenerateMessageInput): Promise<MessageResponse> {
  const limited = isLimitedPersonalization(input.enrichmentData);
  const personalizationDetails = collectPersonalizationDetails(input.enrichmentData);
  const prompt = buildPrompt(input);
  const systemPrompt = `TONE DIRECTIVE: ${TONE_MODIFIERS[input.tone]}\n\n${COLD_OUTREACH_SYSTEM_PROMPT}`;

  let rawMessage: string;
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    rawMessage = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!rawMessage) {
      throw new Error('Empty response from LLM');
    }
  } catch (err: unknown) {
    const error = new Error(
      `LLM unavailable: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
    (error as Error & { code: string }).code = 'LLM_UNAVAILABLE';
    throw error;
  }

  // Enforce word count limits
  const message = enforceWordLimit(rawMessage, input.messageType);

  return {
    message,
    subjectLine: generateSubjectLine(input.leadName, input.leadCompany, input.leadRole),
    personalizationDetails,
    limitedPersonalization: limited,
  };
}

// ---------------------------------------------------------------------------
// Cold outreach system prompt
// ---------------------------------------------------------------------------

/**
 * System prompt distilled from proven cold outreach strategy.
 * Teaches the model to write like a smart friend, not a desperate salesperson.
 */
export const COLD_OUTREACH_SYSTEM_PROMPT = `You are an outreach writer. You write like a thoughtful person reaching out to someone whose work they genuinely respect. Warm, specific, human. Not a marketer. Not a salesperson.

Your only job: make one specific person feel seen, and want to respond.

RULES (non-negotiable):
- Start with: Hi [First name],
- End with: Warm regards, [Sender name]
- 3-5 short paragraphs. Each paragraph 1-2 sentences max.
- The first paragraph must reference something SPECIFIC about their work. Not flattery. A real detail that shows you paid attention.
- The second paragraph introduces what you're reaching out about. Be clear and concise about what it is.
- The third paragraph connects why it's relevant to THEM specifically.
- The final paragraph is a soft, respectful ask. Give them options for how to engage.
- NEVER use em dashes. Use commas, periods, or restructure the sentence.
- Every sentence must feel like it was written for exactly one person.
- Write like a human. Use contractions. Be warm but not sycophantic.

BANNED WORDS/PHRASES (use any of these = fail):
hefty, impressive, stands out, really stands out, I noticed, I believe, it's clear that, especially with how, I wanted to reach out, would love to connect, quick question, following up, touching base, I hope this finds you well, partnership opportunity, I came across, synergy, circle back, is commendable, is crucial, it must be challenging

OUTPUT: message text only. No subject line. No commentary.`;

// ---------------------------------------------------------------------------
// Banned phrases
// ---------------------------------------------------------------------------

export const BANNED_PHRASES = [
  'I hope this finds you well',
  'I hope this email finds you well',
  'I came across your profile',
  'I wanted to reach out',
  'I wanted to connect',
  'Would love to connect',
  'Would love to pick your brain',
  'Quick question',
  'Following up',
  'Partnership opportunity',
  "Let me know if there's anything you need help with",
  'Just checking in',
  'Touching base',
  'Synergy',
  'Circle back',
];

// ---------------------------------------------------------------------------
// Enhanced personalization helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a PersonalizationContext has enough data for full
 * personalization. Returns true (limited) when the research profile has
 * no usable content lists.
 */
function isEnhancedPersonalizationLimited(ctx?: PersonalizationContext): boolean {
  if (!ctx) return true;
  const rp = ctx.researchProfile;
  const hasTopics = rp.topicsOfInterest.length > 0;
  const hasChallenges = rp.currentChallenges.length > 0;
  const hasActivity = rp.recentActivity.length > 0;
  const hasContent = rp.publishedContentSummaries.length > 0;
  return !hasTopics && !hasChallenges && !hasActivity && !hasContent;
}

// ---------------------------------------------------------------------------
// ContentSummary prompt helpers
// ---------------------------------------------------------------------------

/**
 * Build a prompt section that includes specific details from the prospect's
 * published content (ContentSummary data). Prefers `selectedContentDetail`
 * (already chosen for topic overlap with ICP pain points) and falls back to
 * the first available ContentSummary.
 *
 * Returns an empty string when no ContentSummary data is available, so the
 * prompt falls back to existing behaviour.
 *
 * Requirements: 4.1, 4.2, 4.3
 */
export function buildContentDetailSection(ctx: PersonalizationContext): string {
  const detail: ContentSummary | undefined =
    ctx.selectedContentDetail ??
    (ctx.contentSummaries && ctx.contentSummaries.length > 0 ? ctx.contentSummaries[0] : undefined);

  if (!detail) return '';

  const lines: string[] = ["PROSPECT'S PUBLISHED CONTENT:"];

  lines.push(`Source: ${detail.sourceUrl}`);
  lines.push(`Synopsis: ${detail.synopsis}`);

  if (detail.keyPoints.length > 0) {
    lines.push('Key points:');
    for (const kp of detail.keyPoints) {
      lines.push(`- ${kp}`);
    }
  }

  if (detail.notableQuotes.length > 0) {
    lines.push('Notable quotes:');
    for (const q of detail.notableQuotes) {
      lines.push(`- "${q}"`);
    }
  }

  if (detail.opinions.length > 0) {
    lines.push('Opinions expressed:');
    for (const o of detail.opinions) {
      lines.push(`- ${o}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Enhanced prompt construction
// ---------------------------------------------------------------------------

/**
 * Build an enhanced prompt that includes Research Profile content references,
 * pain point intersection, and banned phrase avoidance instructions.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
export function buildEnhancedPrompt(input: EnhancedGenerateMessageInput): string {
  const { leadName, leadRole, leadCompany, messageType, tone, productContext } = input;
  const ctx = input.personalizationContext;

  // Fall back to basic prompt when no personalization context
  if (!ctx) {
    return buildPrompt(input);
  }

  const typeLabel = messageType === 'cold_dm' ? 'cold DM' : 'cold email';
  const wordLimit = getWordLimit(messageType);

  // --- Value proposition / product context ---
  const valueSection = ctx.enrichedICP.valueProposition
    ? `Value proposition: ${ctx.enrichedICP.valueProposition}`
    : '';

  const productDesc = ctx.enrichedICP.productDescription
    ? `Product description: ${ctx.enrichedICP.productDescription}`
    : '';

  // --- Recent content reference (prioritise <30 days) ---
  let contentReferenceSection = '';
  if (ctx.recentContentReference) {
    const ref = ctx.recentContentReference;
    contentReferenceSection = `Recent prospect activity (reference this in the message):\n- "${ref.summary}" (source: ${ref.source}, date: ${new Date(ref.timestamp).toISOString().slice(0, 10)})`;
  } else if (ctx.researchProfile.recentActivity.length > 0) {
    // Fall back to the most recent activity even if older than 30 days
    const sorted = [...ctx.researchProfile.recentActivity].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const ref = sorted[0];
    contentReferenceSection = `Prospect activity (reference this in the message):\n- "${ref.summary}" (source: ${ref.source}, date: ${new Date(ref.timestamp).toISOString().slice(0, 10)})`;
  }

  // --- Pain point intersection ---
  let painPointSection = '';
  if (ctx.painPointReference) {
    const pp = ctx.painPointReference;
    painPointSection = `Challenge intersection (address this — connect the prospect's challenge to what you're offering):\n- Offer addresses: "${pp.founderPainPoint}"\n- Prospect struggles with: "${pp.prospectChallenge}"`;
  } else if (ctx.intersectionAnalysis.painPointMatches.length > 0) {
    const best = ctx.intersectionAnalysis.painPointMatches[0];
    painPointSection = `Challenge intersection (address this — connect the prospect's challenge to what you're offering):\n- Offer addresses: "${best.founderPainPoint}"\n- Prospect struggles with: "${best.prospectChallenge}"`;
  }

  // Always include the ICP's pain points so the LLM knows what the offer solves
  const icpPainPoints = ctx.enrichedICP.painPointsSolved?.length
    ? `Challenges this offer addresses (use the most relevant one for THIS prospect's role/industry):\n${ctx.enrichedICP.painPointsSolved.map((p) => `- ${p}`).join('\n')}`
    : '';

  // --- Topics of interest ---
  let topicsSection = '';
  if (ctx.researchProfile.topicsOfInterest.length > 0) {
    topicsSection = `Prospect's topics of interest: ${ctx.researchProfile.topicsOfInterest.join(', ')}`;
  }

  // --- Prospect's published content (ContentSummary) ---
  const contentDetailSection = buildContentDetailSection(ctx);

  // --- Content reference instruction ---
  const contentInstruction = contentDetailSection
    ? "Your hook MUST reference a specific detail (a quote, opinion, or key point) from the prospect's published content above."
    : '';

  // --- Project name ---
  const projectSection = input.projectName ? `Project: ${input.projectName}` : '';
  const signOff = input.emailSignature
    ? `Use this EXACT sign-off (do not modify it):\n${input.emailSignature}`
    : input.senderName
      ? `Sign off with: "Warm regards,\n${input.senderName}"`
      : 'Sign off with "Warm regards," followed by the sender\'s first name. If unknown, just use "Warm regards."';

  // --- Steering context ---
  const globalSteeringSection = input.globalSteering
    ? `\nGLOBAL STEERING (apply to all messages unless overridden by per-lead steering):\n${input.globalSteering}`
    : '';
  const steeringSection = input.steeringContext
    ? `\nPER-LEAD STEERING (high priority — follow these instructions for this specific lead):\n${input.steeringContext}`
    : '';

  // --- Call notes ---
  const callNotesSection =
    input.callNotes && input.callNotes.length > 0
      ? `\nCALL NOTES & INSIGHTS:\n${input.callNotes
          .map(
            (cn) =>
              `- Pain points: ${cn.painPoints.join(', ')}\n  Objections: ${cn.objections.join(', ')}\n  Sentiment: ${cn.sentiment}`,
          )
          .join('\n')}`
      : '';

  // --- Assemble prompt: bible first, then data ---
  const sections = [
    COLD_OUTREACH_BIBLE,
    '---',
    `Write a ${typeLabel} to ${leadName}, who is a ${leadRole} at ${leadCompany}.`,
    `Tone: ${tone}. Word limit: ${wordLimit} words max.`,
    projectSection,
    `What you're offering: ${productContext}`,
    productDesc ? `Description: ${productDesc}` : '',
    valueSection,
    contentReferenceSection,
    painPointSection,
    icpPainPoints,
    topicsSection,
    contentDetailSection,
    contentInstruction,
    globalSteeringSection,
    steeringSection,
    callNotesSection,
    signOff,
    'Output ONLY the message text. No subject line. No "Subject:" prefix. No commentary.',
  ].filter(Boolean);

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Enhanced message generation
// ---------------------------------------------------------------------------

/**
 * Generate a hyper-personalized outreach message using the PersonalizationContext.
 *
 * Falls back to existing generation when no Research Profile or Enriched ICP
 * is available, setting `limitedPersonalization: true`.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */
export async function generateEnhancedMessage(
  input: EnhancedGenerateMessageInput,
): Promise<EnhancedMessageResponse> {
  const ctx = input.personalizationContext;

  // Fall back to existing generation when no personalization context
  if (!ctx || isEnhancedPersonalizationLimited(ctx)) {
    const baseResult = await generateMessage(input);
    return {
      ...baseResult,
      limitedPersonalization: true,
      personalizationMetadata: ctx
        ? {
            sourcesUsed: ctx.researchProfile.sourcesUsed,
            painPointsReferenced: [],
            contentReferenced: [],
            intersectionScore: ctx.intersectionAnalysis.overallRelevanceScore,
          }
        : undefined,
    };
  }

  // Build enhanced prompt
  const prompt = buildEnhancedPrompt(input);

  // Collect metadata
  const sourcesUsed = ctx.researchProfile.sourcesUsed;
  const painPointsReferenced: string[] = [];
  const contentReferenced: string[] = [];

  if (ctx.painPointReference) {
    painPointsReferenced.push(ctx.painPointReference.founderPainPoint);
  } else if (ctx.intersectionAnalysis.painPointMatches.length > 0) {
    painPointsReferenced.push(ctx.intersectionAnalysis.painPointMatches[0].founderPainPoint);
  }

  if (ctx.recentContentReference) {
    contentReferenced.push(ctx.recentContentReference.summary);
  } else if (ctx.researchProfile.recentActivity.length > 0) {
    const sorted = [...ctx.researchProfile.recentActivity].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    contentReferenced.push(sorted[0].summary);
  }

  // Include ContentSummary source URLs in contentReferenced
  if (ctx.selectedContentDetail) {
    contentReferenced.push(ctx.selectedContentDetail.sourceUrl);
  }
  if (ctx.contentSummaries && ctx.contentSummaries.length > 0) {
    for (const cs of ctx.contentSummaries) {
      if (cs.sourceUrl && !contentReferenced.includes(cs.sourceUrl)) {
        contentReferenced.push(cs.sourceUrl);
      }
    }
  }

  const metadata: PersonalizationMetadata = {
    sourcesUsed,
    painPointsReferenced,
    contentReferenced,
    intersectionScore: ctx.intersectionAnalysis.overallRelevanceScore,
  };

  let rawMessage: string;
  try {
    const client = getOpenAIClient();
    const systemPrompt = `TONE DIRECTIVE: ${TONE_MODIFIERS[input.tone]}\n\n${COLD_OUTREACH_SYSTEM_PROMPT}`;
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    rawMessage = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!rawMessage) {
      throw new Error('Empty response from LLM');
    }
  } catch (err: unknown) {
    const error = new Error(
      `LLM unavailable: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
    (error as Error & { code: string }).code = 'LLM_UNAVAILABLE';
    throw error;
  }

  // Enforce word count limits
  const message = enforceWordLimit(rawMessage, input.messageType);

  // Collect personalization details for backward compatibility
  const personalizationDetails = collectPersonalizationDetails(input.enrichmentData);
  if (ctx.recentContentReference) {
    personalizationDetails.push(`Recent activity: ${ctx.recentContentReference.summary}`);
  }
  if (ctx.painPointReference) {
    personalizationDetails.push(`Pain point: ${ctx.painPointReference.founderPainPoint}`);
  }

  return {
    message,
    subjectLine: generateSubjectLine(input.leadName, input.leadCompany, input.leadRole),
    personalizationDetails,
    limitedPersonalization: false,
    personalizationMetadata: metadata,
  };
}

// ---------------------------------------------------------------------------
// Message generation with on-demand research fallback
// ---------------------------------------------------------------------------

/**
 * Generate a message with on-demand research fallback.
 *
 * 1. Check if the lead's enrichment data + research profile have ≥ 2
 *    personalization-worthy data points via `hasSufficientPersonalization`.
 * 2. If insufficient, trigger `researchProspect` for on-demand research.
 * 3. After research, use the enhanced prompt path with research profile context.
 * 4. If on-demand research also fails to produce sufficient context, generate
 *    a role-and-company-specific message with `limitedPersonalization: true`.
 * 5. Record in `personalizationMetadata` which sources contributed and whether
 *    on-demand research was triggered.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
export async function generateMessageWithResearchFallback(
  input: EnhancedGenerateMessageInput,
  leadId: string,
): Promise<EnhancedMessageResponse> {
  let researchProfile: ResearchProfile | null = null;
  let onDemandResearchTriggered = false;

  // Step 1: Retrieve existing research profile
  try {
    researchProfile = await getResearchProfile(leadId);
  } catch {
    // If we can't fetch the profile, proceed without it
  }

  // Step 2: Check if we have sufficient personalization
  const sufficient = hasSufficientPersonalization(
    input.enrichmentData,
    researchProfile ?? undefined,
  );

  // Step 3: If insufficient, trigger on-demand research
  if (!sufficient) {
    onDemandResearchTriggered = true;

    try {
      const lead = await getLeadById(leadId);
      if (lead) {
        researchProfile = await researchProspect(lead);
      }
    } catch {
      // On-demand research failed — we'll fall back below
    }
  }

  // Step 4: Check sufficiency again after on-demand research
  const sufficientAfterResearch = hasSufficientPersonalization(
    input.enrichmentData,
    researchProfile ?? undefined,
  );

  // Step 5: If we have a personalization context on the input, use enhanced path
  if (sufficientAfterResearch && input.personalizationContext) {
    const result = await generateEnhancedMessage(input);
    // Augment metadata with on-demand research info
    const metadata: PersonalizationMetadata = result.personalizationMetadata ?? {
      sourcesUsed: [],
      painPointsReferenced: [],
      contentReferenced: [],
      intersectionScore: 0,
    };
    if (onDemandResearchTriggered) {
      metadata.sourcesUsed = [
        ...new Set([...metadata.sourcesUsed, ...(researchProfile?.sourcesUsed ?? [])]),
      ];
    }
    return {
      ...result,
      personalizationMetadata: {
        ...metadata,
        onDemandResearchTriggered,
      } as PersonalizationMetadata & { onDemandResearchTriggered: boolean },
    };
  }

  // Step 6: If we have research data but no pre-built personalization context,
  // try to build one from the research profile
  if (sufficientAfterResearch && researchProfile) {
    try {
      const enrichedICP = input.personalizationContext?.enrichedICP ?? {
        targetRole: input.leadRole,
        industry: '',
        companyStage: '' as const,
        geography: '',
        productDescription: input.productContext,
      };

      const ctx = await buildPersonalizationContext(
        enrichedICP as import('@/types').EnrichedICP,
        researchProfile,
      );

      const enhancedInput: EnhancedGenerateMessageInput = {
        ...input,
        personalizationContext: ctx,
      };

      const result = await generateEnhancedMessage(enhancedInput);
      const sourcesUsed = [
        ...new Set([
          ...(result.personalizationMetadata?.sourcesUsed ?? []),
          ...(researchProfile.sourcesUsed ?? []),
        ]),
      ];

      return {
        ...result,
        personalizationMetadata: {
          sourcesUsed,
          painPointsReferenced: result.personalizationMetadata?.painPointsReferenced ?? [],
          contentReferenced: result.personalizationMetadata?.contentReferenced ?? [],
          intersectionScore: result.personalizationMetadata?.intersectionScore ?? 0,
          onDemandResearchTriggered,
        } as PersonalizationMetadata & { onDemandResearchTriggered: boolean },
      };
    } catch {
      // Failed to build personalization context — fall through to limited path
    }
  }

  // Step 7: Fall back to role-and-company-specific message with limited personalization
  const baseResult = await generateMessage(input);
  const fallbackSourcesUsed = researchProfile?.sourcesUsed ?? [];
  if (input.enrichmentData?.dataSources) {
    fallbackSourcesUsed.push(...input.enrichmentData.dataSources);
  }

  return {
    ...baseResult,
    limitedPersonalization: true,
    personalizationMetadata: {
      sourcesUsed: [...new Set(fallbackSourcesUsed)],
      painPointsReferenced: [],
      contentReferenced: [],
      intersectionScore: 0,
      onDemandResearchTriggered,
    } as PersonalizationMetadata & { onDemandResearchTriggered: boolean },
  };
}
