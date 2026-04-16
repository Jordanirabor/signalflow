import type { ContentSummary } from '@/types';
import OpenAI from 'openai';

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
// Validation & clamping helpers
// ---------------------------------------------------------------------------

/**
 * Validate and clamp a raw parsed response into a valid ContentSummary.
 * Attempts to fix out-of-bounds values before rejecting.
 * Returns null if the response is fundamentally invalid.
 */
export function validateAndClamp(raw: unknown, sourceUrl: string): ContentSummary | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  // --- synopsis ---
  if (typeof obj.synopsis !== 'string' || obj.synopsis.trim().length === 0) return null;
  const synopsis = obj.synopsis.trim().slice(0, 300);

  // --- keyPoints ---
  if (!Array.isArray(obj.keyPoints)) return null;
  const keyPoints = obj.keyPoints
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => s.trim());
  if (keyPoints.length === 0) return null;
  const clampedKeyPoints = keyPoints.slice(0, 5);

  // --- notableQuotes ---
  const rawQuotes = Array.isArray(obj.notableQuotes) ? obj.notableQuotes : [];
  const notableQuotes = rawQuotes
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 3);

  // --- opinions ---
  const rawOpinions = Array.isArray(obj.opinions) ? obj.opinions : [];
  const opinions = rawOpinions
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 3);

  // --- topics ---
  if (!Array.isArray(obj.topics)) return null;
  const topics = obj.topics
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => s.trim());
  if (topics.length === 0) return null;
  const clampedTopics = topics.slice(0, 5);

  return {
    synopsis,
    keyPoints: clampedKeyPoints,
    notableQuotes,
    opinions,
    topics: clampedTopics,
    sourceUrl,
  };
}

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

const SUMMARIZATION_PROMPT = `Extract a structured summary from the following article text.
Return a JSON object with these fields:
- synopsis: A single-paragraph plain-text summary, max 300 characters
- keyPoints: Array of 1-5 key points from the article
- notableQuotes: Array of 0-3 notable direct quotes
- opinions: Array of 0-3 opinions expressed by the author
- topics: Array of 1-5 topics discussed

Article text:
`;

/**
 * Summarize extracted article text into a structured ContentSummary using OpenAI.
 *
 * Returns null on any failure: empty input, API error, timeout, or invalid response.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */
export async function summarizeContent(
  text: string,
  sourceUrl: string,
): Promise<ContentSummary | null> {
  // Return null immediately for empty article text (no API call)
  if (!text || text.trim().length === 0) {
    return null;
  }

  try {
    const client = getOpenAIClient();

    // 15-second timeout via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
      const completion = await client.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a content analysis assistant. Extract structured summaries from article text. Always respond with valid JSON.',
            },
            {
              role: 'user',
              content: `${SUMMARIZATION_PROMPT}${text}`,
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1000,
          temperature: 0.3,
        },
        { signal: controller.signal },
      );

      clearTimeout(timeoutId);

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return null;
      }

      return validateAndClamp(parsed, sourceUrl);
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  } catch {
    // API error, timeout, or any other failure → return null
    return null;
  }
}
