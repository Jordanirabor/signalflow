import {
  BANNED_PHRASES,
  buildEnhancedPrompt,
  generateEnhancedMessage,
  setOpenAIClient,
  type EnhancedGenerateMessageInput,
} from '@/services/messageService';
import type {
  EnrichedICP,
  IntersectionAnalysis,
  PersonalizationContext,
  ResearchActivity,
  ResearchProfile,
} from '@/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResearchActivity(overrides?: Partial<ResearchActivity>): ResearchActivity {
  return {
    summary: 'Spoke at SaaS conference about scaling teams',
    source: 'linkedin',
    timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    url: 'https://linkedin.com/post/123',
    ...overrides,
  };
}

function makeResearchProfile(overrides?: Partial<ResearchProfile>): ResearchProfile {
  return {
    leadId: 'lead-1',
    topicsOfInterest: ['SaaS growth', 'team scaling'],
    currentChallenges: ['Hiring senior engineers', 'Reducing churn'],
    recentActivity: [makeResearchActivity()],
    publishedContentSummaries: ['Blog post about engineering culture'],
    overallSentiment: 'positive',
    sourcesUsed: ['linkedin', 'twitter'],
    sourcesUnavailable: [],
    researchedAt: new Date(),
    ...overrides,
  };
}

function makeEnrichedICP(overrides?: Partial<EnrichedICP>): EnrichedICP {
  return {
    id: 'icp-1',
    founderId: 'founder-1',
    targetRole: 'CTO',
    industry: 'SaaS',
    createdAt: new Date(),
    updatedAt: new Date(),
    productDescription: 'AI-powered hiring platform',
    valueProposition: 'Reduce time-to-hire by 50%',
    painPointsSolved: ['Slow hiring process', 'Poor candidate quality'],
    competitorContext: 'Competes with Lever and Greenhouse',
    idealCustomerCharacteristics: 'Series A+ SaaS companies',
    ...overrides,
  };
}

function makeIntersectionAnalysis(overrides?: Partial<IntersectionAnalysis>): IntersectionAnalysis {
  return {
    painPointMatches: [
      {
        founderPainPoint: 'Slow hiring process',
        prospectChallenge: 'Hiring senior engineers',
        similarityScore: 0.85,
      },
    ],
    overallRelevanceScore: 0.85,
    ...overrides,
  };
}

function makePersonalizationContext(
  overrides?: Partial<PersonalizationContext>,
): PersonalizationContext {
  return {
    enrichedICP: makeEnrichedICP(),
    researchProfile: makeResearchProfile(),
    intersectionAnalysis: makeIntersectionAnalysis(),
    recentContentReference: makeResearchActivity(),
    painPointReference: {
      founderPainPoint: 'Slow hiring process',
      prospectChallenge: 'Hiring senior engineers',
      similarityScore: 0.85,
    },
    ...overrides,
  };
}

function makeBaseInput(): EnhancedGenerateMessageInput {
  return {
    leadName: 'Jane Doe',
    leadRole: 'CTO',
    leadCompany: 'Acme Corp',
    messageType: 'cold_email',
    tone: 'professional',
    productContext: 'AI-powered hiring platform that reduces time-to-hire',
    personalizationContext: makePersonalizationContext(),
  };
}

// ---------------------------------------------------------------------------
// Mock OpenAI
// ---------------------------------------------------------------------------

function createMockOpenAI(responseText: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseText } }],
        }),
      },
    },
  } as unknown as import('openai').default;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildEnhancedPrompt', () => {
  it('falls back to basic prompt when no personalization context', () => {
    const input = makeBaseInput();
    input.personalizationContext = undefined;

    const prompt = buildEnhancedPrompt(input);

    // Should be a basic prompt (no banned phrases section, no intersection)
    expect(prompt).toContain('Jane Doe');
    expect(prompt).toContain('CTO');
    expect(prompt).not.toContain('IMPORTANT: Do NOT use any of these generic phrases');
  });

  it('includes banned phrase avoidance instructions', () => {
    const prompt = buildEnhancedPrompt(makeBaseInput());

    for (const phrase of BANNED_PHRASES) {
      expect(prompt).toContain(phrase);
    }
    expect(prompt).toContain('Do NOT use');
  });

  it('includes recent content reference from personalization context', () => {
    const prompt = buildEnhancedPrompt(makeBaseInput());

    expect(prompt).toContain('Spoke at SaaS conference about scaling teams');
    expect(prompt).toContain('linkedin');
  });

  it('includes pain point intersection', () => {
    const prompt = buildEnhancedPrompt(makeBaseInput());

    expect(prompt).toContain('Slow hiring process');
    expect(prompt).toContain('Hiring senior engineers');
  });

  it('includes value proposition from enriched ICP', () => {
    const prompt = buildEnhancedPrompt(makeBaseInput());

    expect(prompt).toContain('Reduce time-to-hire by 50%');
  });

  it('includes product description from enriched ICP', () => {
    const prompt = buildEnhancedPrompt(makeBaseInput());

    expect(prompt).toContain('AI-powered hiring platform');
  });

  it('includes topics of interest', () => {
    const prompt = buildEnhancedPrompt(makeBaseInput());

    expect(prompt).toContain('SaaS growth');
    expect(prompt).toContain('team scaling');
  });

  it('enforces word limit for cold_dm (150)', () => {
    const input = makeBaseInput();
    input.messageType = 'cold_dm';
    const prompt = buildEnhancedPrompt(input);

    expect(prompt).toContain('150 words maximum');
  });

  it('enforces word limit for cold_email (250)', () => {
    const input = makeBaseInput();
    input.messageType = 'cold_email';
    const prompt = buildEnhancedPrompt(input);

    expect(prompt).toContain('250 words maximum');
  });

  it('falls back to first activity when recentContentReference is null', () => {
    const input = makeBaseInput();
    const activity = makeResearchActivity({
      summary: 'Old blog post about DevOps',
      timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
    });
    input.personalizationContext = makePersonalizationContext({
      recentContentReference: null,
      researchProfile: makeResearchProfile({ recentActivity: [activity] }),
    });

    const prompt = buildEnhancedPrompt(input);

    expect(prompt).toContain('Old blog post about DevOps');
  });

  it('falls back to first pain point match when painPointReference is null', () => {
    const input = makeBaseInput();
    input.personalizationContext = makePersonalizationContext({
      painPointReference: null,
      intersectionAnalysis: makeIntersectionAnalysis({
        painPointMatches: [
          {
            founderPainPoint: 'Poor candidate quality',
            prospectChallenge: 'Reducing churn',
            similarityScore: 0.6,
          },
        ],
      }),
    });

    const prompt = buildEnhancedPrompt(input);

    expect(prompt).toContain('Poor candidate quality');
    expect(prompt).toContain('Reducing churn');
  });

  it('instructs to reference content and address pain points', () => {
    const prompt = buildEnhancedPrompt(makeBaseInput());

    expect(prompt).toContain('reference a specific piece of the prospect');
    expect(prompt).toContain('pain point around what it costs THEM');
  });
});

describe('generateEnhancedMessage', () => {
  beforeEach(() => {
    setOpenAIClient(null);
  });

  it('falls back to basic generation when no personalization context', async () => {
    const mockClient = createMockOpenAI('Hello Jane, great to connect.');
    setOpenAIClient(mockClient);

    const input = makeBaseInput();
    input.personalizationContext = undefined;

    const result = await generateEnhancedMessage(input);

    expect(result.limitedPersonalization).toBe(true);
    expect(result.personalizationMetadata).toBeUndefined();
    expect(result.message).toBe('Hello Jane, great to connect.');
  });

  it('falls back when research profile has empty content lists', async () => {
    const mockClient = createMockOpenAI('Hello Jane, generic message.');
    setOpenAIClient(mockClient);

    const input = makeBaseInput();
    input.personalizationContext = makePersonalizationContext({
      researchProfile: makeResearchProfile({
        topicsOfInterest: [],
        currentChallenges: [],
        recentActivity: [],
        publishedContentSummaries: [],
      }),
    });

    const result = await generateEnhancedMessage(input);

    expect(result.limitedPersonalization).toBe(true);
    expect(result.personalizationMetadata).toBeDefined();
    expect(result.personalizationMetadata!.sourcesUsed).toEqual(['linkedin', 'twitter']);
  });

  it('generates enhanced message with full personalization context', async () => {
    const mockClient = createMockOpenAI(
      'Hi Jane, I noticed your talk at the SaaS conference about scaling teams. Given your challenge with hiring senior engineers, our AI platform could help.',
    );
    setOpenAIClient(mockClient);

    const result = await generateEnhancedMessage(makeBaseInput());

    expect(result.limitedPersonalization).toBe(false);
    expect(result.personalizationMetadata).toBeDefined();
    expect(result.personalizationMetadata!.sourcesUsed).toEqual(['linkedin', 'twitter']);
    expect(result.personalizationMetadata!.painPointsReferenced).toContain('Slow hiring process');
    expect(result.personalizationMetadata!.contentReferenced).toContain(
      'Spoke at SaaS conference about scaling teams',
    );
    expect(result.personalizationMetadata!.intersectionScore).toBe(0.85);
  });

  it('enforces word limit on enhanced messages', async () => {
    // Generate a message that exceeds 150 words for a DM
    const longMessage = Array(200).fill('word').join(' ');
    const mockClient = createMockOpenAI(longMessage);
    setOpenAIClient(mockClient);

    const input = makeBaseInput();
    input.messageType = 'cold_dm';

    const result = await generateEnhancedMessage(input);

    const wordCount = result.message.split(/\s+/).filter((w) => w.length > 0).length;
    expect(wordCount).toBeLessThanOrEqual(150);
  });

  it('throws LLM_UNAVAILABLE on OpenAI failure', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('API rate limit')),
        },
      },
    } as unknown as import('openai').default;
    setOpenAIClient(mockClient);

    await expect(generateEnhancedMessage(makeBaseInput())).rejects.toThrow('LLM unavailable');
  });

  it('includes personalization details for backward compatibility', async () => {
    const mockClient = createMockOpenAI('Personalized message here.');
    setOpenAIClient(mockClient);

    const input = makeBaseInput();
    input.enrichmentData = {
      linkedinBio: 'Experienced CTO',
    };

    const result = await generateEnhancedMessage(input);

    expect(result.personalizationDetails).toContain('LinkedIn bio: Experienced CTO');
    expect(result.personalizationDetails).toContain(
      'Recent activity: Spoke at SaaS conference about scaling teams',
    );
    expect(result.personalizationDetails).toContain('Pain point: Slow hiring process');
  });

  it('returns metadata with content from fallback activity when recentContentReference is null', async () => {
    const mockClient = createMockOpenAI('Message referencing old content.');
    setOpenAIClient(mockClient);

    const activity = makeResearchActivity({
      summary: 'Podcast about engineering leadership',
      timestamp: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
    });

    const input = makeBaseInput();
    input.personalizationContext = makePersonalizationContext({
      recentContentReference: null,
      researchProfile: makeResearchProfile({ recentActivity: [activity] }),
    });

    const result = await generateEnhancedMessage(input);

    expect(result.personalizationMetadata!.contentReferenced).toContain(
      'Podcast about engineering leadership',
    );
  });
});
