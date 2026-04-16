import { query } from '@/lib/db';
import type { ClassificationResult, ResponseClassification } from '@/types';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Valid classifications
// ---------------------------------------------------------------------------

const VALID_CLASSIFICATIONS: ResponseClassification[] = [
  'interested',
  'not_interested',
  'objection',
  'question',
  'out_of_office',
];

// ---------------------------------------------------------------------------
// Manual review threshold
// ---------------------------------------------------------------------------

/**
 * Pure function: returns true iff confidence < 0.7.
 * Exported for property-based testing.
 */
export function shouldFlagForManualReview(confidence: number): boolean {
  return confidence < 0.7;
}

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton — same pattern as messageService)
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
// Prompt construction
// ---------------------------------------------------------------------------

function buildClassificationPrompt(replyText: string, conversationContext?: string): string {
  const contextSection = conversationContext
    ? `\nPrevious conversation context:\n${conversationContext}\n`
    : '';

  return `You are an AI assistant that classifies email replies from sales prospects.

Classify the following reply into exactly one of these categories:
- interested: The prospect expresses interest in learning more, scheduling a meeting, or continuing the conversation.
- not_interested: The prospect explicitly declines, asks to be removed, or shows no interest.
- objection: The prospect raises a concern, pushback, or objection about the product/service/timing.
- question: The prospect asks a question seeking more information without clear interest or disinterest.
- out_of_office: The reply is an automated out-of-office or vacation message.
${contextSection}
Reply to classify:
"""
${replyText}
"""

Respond in valid JSON with this exact structure:
{
  "classification": "<one of: interested, not_interested, objection, question, out_of_office>",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<brief explanation of why this classification was chosen>",
  "detectedReturnDate": "<ISO 8601 date string if out_of_office and a return date is mentioned, otherwise null>"
}`;
}

// ---------------------------------------------------------------------------
// Parse LLM response
// ---------------------------------------------------------------------------

function parseClassificationResponse(raw: string): ClassificationResult {
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();
  const parsed = JSON.parse(cleaned);

  const classification = parsed.classification as string;
  if (!VALID_CLASSIFICATIONS.includes(classification as ResponseClassification)) {
    throw new Error(`Invalid classification: ${classification}`);
  }

  let confidence = Number(parsed.confidence);
  if (isNaN(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const result: ClassificationResult = {
    classification: classification as ResponseClassification,
    confidence,
    reasoning: String(parsed.reasoning ?? ''),
  };

  if (
    classification === 'out_of_office' &&
    parsed.detectedReturnDate &&
    parsed.detectedReturnDate !== 'null'
  ) {
    const returnDate = new Date(parsed.detectedReturnDate);
    if (!isNaN(returnDate.getTime())) {
      result.detectedReturnDate = returnDate;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Store classification in incoming_reply table
// ---------------------------------------------------------------------------

async function storeClassification(
  replyId: string,
  result: ClassificationResult,
  requiresManualReview: boolean,
): Promise<void> {
  await query(
    `UPDATE incoming_reply
     SET classification_result     = $1,
         classification_confidence = $2,
         classification_reasoning  = $3,
         detected_return_date      = $4,
         requires_manual_review    = $5,
         processed_at              = NOW()
     WHERE id = $6`,
    [
      result.classification,
      result.confidence,
      result.reasoning,
      result.detectedReturnDate ?? null,
      requiresManualReview,
      replyId,
    ],
  );
}

// ---------------------------------------------------------------------------
// Main classification function
// ---------------------------------------------------------------------------

/**
 * Classify a prospect reply using OpenAI.
 *
 * - Calls OpenAI to classify the reply text
 * - Stores the classification result in the incoming_reply table
 * - Flags replies with confidence < 0.7 for manual review
 *
 * @param replyId - The incoming_reply row ID to update
 * @param replyText - The raw reply text to classify
 * @param conversationContext - Optional previous conversation context
 * @returns ClassificationResult with classification, confidence, reasoning, and optional return date
 */
export async function classifyReply(
  replyId: string,
  replyText: string,
  conversationContext?: string,
): Promise<ClassificationResult> {
  const prompt = buildClassificationPrompt(replyText, conversationContext);

  let rawResponse: string;
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert at classifying sales prospect email replies. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.2,
    });

    rawResponse = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!rawResponse) {
      throw new Error('Empty response from LLM');
    }
  } catch (err: unknown) {
    const error = new Error(
      `LLM unavailable: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
    (error as Error & { code: string }).code = 'LLM_UNAVAILABLE';
    throw error;
  }

  const result = parseClassificationResponse(rawResponse);
  const requiresManualReview = shouldFlagForManualReview(result.confidence);

  await storeClassification(replyId, result, requiresManualReview);

  return result;
}
