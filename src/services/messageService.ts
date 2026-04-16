import type {
  ContentSummary,
  EnhancedMessageResponse,
  EnrichmentData,
  MessageResponse,
  MessageType,
  PersonalizationContext,
  PersonalizationMetadata,
  TonePreference,
} from '@/types';
import OpenAI from 'openai';

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
  const limit = getWordLimit(messageType);
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length <= limit) return text.trim();
  return words.slice(0, limit).join(' ');
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildPrompt(input: GenerateMessageInput): string {
  const { leadName, leadRole, leadCompany, enrichmentData, messageType, tone, productContext } =
    input;

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

  return `Write a ${typeLabel} to ${leadName}, who is a ${leadRole} at ${leadCompany}.

Tone: ${tone}
Word limit: ${wordLimit} words maximum

Product context: ${productContext}

${personalizationSection}

IMPORTANT: Do NOT use "[Your Name]" as a placeholder. Simply omit the sign-off name if you don't know the sender's name.

Output ONLY the message text, no subject line, no greeting prefix like "Subject:", no extra commentary.`;
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

  let rawMessage: string;
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: COLD_OUTREACH_SYSTEM_PROMPT,
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
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
export const COLD_OUTREACH_SYSTEM_PROMPT = `You are a cold outreach writer who gets 40%+ reply rates. You write like a real human — a smart friend, not a salesperson.

THE PHILOSOPHY:
Cold outreach works when it doesn't feel like outreach. The best emails feel like they were written by someone who genuinely understands the prospect's world and has something worth their time. Most people never ask. They assume the answer is no. Your job is to knock on the door in a way that makes them want to open it.

EXACT STRUCTURE (5 lines, no more):
1. HOOK — One line proving you paid attention. Reference their specific post, talk, product, decision, or words. Not vague flattery. A real detail only they would recognize.
2. THE BRIDGE — Connect their world to the value. Frame the problem around what it costs THEM, not what you solve. Make them feel the pain before you offer the fix.
3. THE OFFER — One sentence. Outcome-focused, not feature-focused. What changes for them?
4. LOW-FRICTION CTA — Make it too easy to say yes. "Mind if I send a 2-min demo?" or "Got 5 min for a quick yes/no?" Never "would love to connect sometime."
5. SIGN OFF — First name only. No titles. No company. No fluff. If you don't know the sender's name, just end after the CTA.

CRITICAL RULES:
- Your first line IS the hook. No "Hey [name]," followed by filler. Jump straight in.
- If the message could be sent to anyone, it's garbage. Every word should prove this was written for exactly one person.
- Nobody cares what you built. They care what it does for THEM.
- Short paragraphs. White space. Scannable. If you can't say it in five lines, you don't understand the offer.
- Write like a human. Use contractions. Use fragments. This is a vibe check, not a thesis.
- Match the platform: DMs are shorter and more casual. Emails can be slightly more structured but still direct.
- NEVER use placeholder text like [Your Name], [Company], etc. Write the actual message.
- NEVER use these phrases: "I hope this finds you well", "I came across your profile", "I wanted to reach out", "Quick question", "Following up", "Partnership opportunity", "Would love to connect", "Let me know if there's anything you need help with", "Just checking in", "Touching base"

THE PRODUCT-PAIN POINT CONNECTION:
This is the most important part. You must creatively and warmly tie the founder's product to the prospect's specific pain point. Don't just mention the product — show how it directly addresses something the prospect is struggling with RIGHT NOW. Use their own words, their own context, their own world to make the connection feel natural, not forced.

Your goal: write a message so specific and human that the prospect thinks "okay, this person actually gets it" and replies.`;

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
    painPointSection = `Pain point intersection (address this in the message):\n- Founder solves: "${pp.founderPainPoint}"\n- Prospect struggles with: "${pp.prospectChallenge}"`;
  } else if (ctx.intersectionAnalysis.painPointMatches.length > 0) {
    const best = ctx.intersectionAnalysis.painPointMatches[0];
    painPointSection = `Pain point intersection (address this in the message):\n- Founder solves: "${best.founderPainPoint}"\n- Prospect struggles with: "${best.prospectChallenge}"`;
  }

  // --- Topics of interest ---
  let topicsSection = '';
  if (ctx.researchProfile.topicsOfInterest.length > 0) {
    topicsSection = `Prospect's topics of interest: ${ctx.researchProfile.topicsOfInterest.join(', ')}`;
  }

  // --- Prospect's published content (ContentSummary) ---
  const contentDetailSection = buildContentDetailSection(ctx);

  // --- Banned phrases ---
  const bannedSection = `IMPORTANT: Do NOT use any of these generic phrases:\n${BANNED_PHRASES.map((p) => `- "${p}"`).join('\n')}`;

  // --- Content reference instruction ---
  const contentInstruction = contentDetailSection
    ? "Your hook MUST reference a specific detail (a quote, opinion, or key point) from the prospect's published content above. Don't just mention it — show you actually read it."
    : "Your hook MUST reference a specific piece of the prospect's recent content or activity. Show you paid attention.";

  // --- Assemble prompt ---
  const sections = [
    `Write a ${typeLabel} to ${leadName}, who is a ${leadRole} at ${leadCompany}.`,
    `Tone: ${tone}`,
    `Word limit: ${wordLimit} words maximum`,
    `Product context: ${productContext}`,
    productDesc,
    valueSection,
    contentReferenceSection,
    painPointSection,
    topicsSection,
    contentDetailSection,
    bannedSection,
    contentInstruction,
    'Frame the pain point around what it costs THEM, not what you solve. Make them feel the problem before you offer the fix.',
    'End with a low-friction CTA — something so easy they\'d feel silly saying no. "Mind if I send a 2-min demo?" or "Got 5 min for a quick yes/no?"',
    'Output ONLY the message text, no subject line, no greeting prefix like "Subject:", no extra commentary.',
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

  // Generate message via OpenAI
  let rawMessage: string;
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: COLD_OUTREACH_SYSTEM_PROMPT,
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
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
    personalizationDetails,
    limitedPersonalization: false,
    personalizationMetadata: metadata,
  };
}
