import type OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  default: {},
}));

import {
  classifyReply,
  setOpenAIClient,
  shouldFlagForManualReview,
} from './responseClassifierService';

// ---------------------------------------------------------------------------
// shouldFlagForManualReview — pure function tests
// ---------------------------------------------------------------------------

describe('shouldFlagForManualReview', () => {
  it('returns true when confidence is 0', () => {
    expect(shouldFlagForManualReview(0)).toBe(true);
  });

  it('returns true when confidence is 0.69', () => {
    expect(shouldFlagForManualReview(0.69)).toBe(true);
  });

  it('returns false when confidence is exactly 0.7', () => {
    expect(shouldFlagForManualReview(0.7)).toBe(false);
  });

  it('returns false when confidence is 0.95', () => {
    expect(shouldFlagForManualReview(0.95)).toBe(false);
  });

  it('returns false when confidence is 1.0', () => {
    expect(shouldFlagForManualReview(1.0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyReply — tests with mocked OpenAI + DB
// ---------------------------------------------------------------------------

function makeMockOpenAI(responseContent: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseContent } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

describe('classifyReply', () => {
  afterEach(() => {
    setOpenAIClient(null);
  });

  it('classifies an interested reply correctly', async () => {
    const mockResponse = JSON.stringify({
      classification: 'interested',
      confidence: 0.92,
      reasoning: 'Prospect expressed interest in scheduling a demo.',
      detectedReturnDate: null,
    });
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const result = await classifyReply('reply-1', 'Yes, I would love to learn more!');
    expect(result.classification).toBe('interested');
    expect(result.confidence).toBe(0.92);
    expect(result.reasoning).toBe('Prospect expressed interest in scheduling a demo.');
    expect(result.detectedReturnDate).toBeUndefined();
  });

  it('classifies an out_of_office reply with return date', async () => {
    const mockResponse = JSON.stringify({
      classification: 'out_of_office',
      confidence: 0.98,
      reasoning: 'Automated OOO reply with return date.',
      detectedReturnDate: '2025-02-01T00:00:00.000Z',
    });
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const result = await classifyReply('reply-2', 'I am out of the office until Feb 1.');
    expect(result.classification).toBe('out_of_office');
    expect(result.detectedReturnDate).toEqual(new Date('2025-02-01T00:00:00.000Z'));
  });

  it('classifies a not_interested reply', async () => {
    const mockResponse = JSON.stringify({
      classification: 'not_interested',
      confidence: 0.85,
      reasoning: 'Prospect asked to be removed from the list.',
      detectedReturnDate: null,
    });
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const result = await classifyReply('reply-3', 'Please remove me from your list.');
    expect(result.classification).toBe('not_interested');
    expect(result.confidence).toBe(0.85);
  });

  it('handles markdown-wrapped JSON from LLM', async () => {
    const mockResponse =
      '```json\n' +
      JSON.stringify({
        classification: 'question',
        confidence: 0.75,
        reasoning: 'Prospect asked about pricing.',
        detectedReturnDate: null,
      }) +
      '\n```';
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const result = await classifyReply('reply-4', 'What is the pricing?');
    expect(result.classification).toBe('question');
    expect(result.confidence).toBe(0.75);
  });

  it('clamps confidence to [0, 1] range', async () => {
    const mockResponse = JSON.stringify({
      classification: 'objection',
      confidence: 1.5,
      reasoning: 'High confidence but out of range.',
      detectedReturnDate: null,
    });
    setOpenAIClient(makeMockOpenAI(mockResponse));

    const result = await classifyReply('reply-5', 'We already have a solution.');
    expect(result.confidence).toBe(1.0);
  });

  it('throws LLM_UNAVAILABLE when OpenAI fails', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('API timeout')),
        },
      },
    } as unknown as OpenAI;
    setOpenAIClient(mockClient);

    await expect(classifyReply('reply-6', 'Hello')).rejects.toThrow('LLM unavailable');
  });

  it('stores classification in the database', async () => {
    const { query: mockQuery } = await import('@/lib/db');
    const mockResponse = JSON.stringify({
      classification: 'interested',
      confidence: 0.9,
      reasoning: 'Interested in demo.',
      detectedReturnDate: null,
    });
    setOpenAIClient(makeMockOpenAI(mockResponse));

    await classifyReply('reply-7', 'Sounds great, let us chat!');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE incoming_reply'),
      expect.arrayContaining(['interested', 0.9, 'Interested in demo.', null, false, 'reply-7']),
    );
  });

  it('flags low-confidence results for manual review in DB', async () => {
    const { query: mockQuery } = await import('@/lib/db');
    const mockResponse = JSON.stringify({
      classification: 'question',
      confidence: 0.5,
      reasoning: 'Unclear intent.',
      detectedReturnDate: null,
    });
    setOpenAIClient(makeMockOpenAI(mockResponse));

    await classifyReply('reply-8', 'Hmm, maybe.');

    // The 5th parameter (requires_manual_review) should be true
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE incoming_reply'),
      expect.arrayContaining([true, 'reply-8']),
    );
  });
});
