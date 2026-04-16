import { query } from '@/lib/db';
import type { CallNote, Tag } from '@/types';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Row types returned by Postgres
// ---------------------------------------------------------------------------

interface CallNoteRow {
  id: string;
  lead_id: string;
  founder_id: string;
  pain_points: string[] | null;
  objections: string[] | null;
  feature_requests: string[] | null;
  next_steps: string | null;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentiment_inferred: boolean;
  raw_text: string;
  tag_generation_failed: boolean;
  created_at: Date;
}

interface TagRow {
  id: string;
  call_note_id: string;
  category: 'pain_point' | 'objection' | 'feature_request';
  value: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface SubmitCallNoteInput {
  leadId: string;
  founderId: string;
  painPoints?: string[];
  objections?: string[];
  featureRequests?: string[];
  nextSteps?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  rawText: string;
}

export interface AggregatedInsight {
  category: 'pain_point' | 'objection' | 'feature_request';
  value: string;
  count: number;
}

export interface AggregatedInsights {
  painPoints: AggregatedInsight[];
  objections: AggregatedInsight[];
  featureRequests: AggregatedInsight[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCallNoteRow(row: CallNoteRow, tags: Tag[]): CallNote {
  return {
    id: row.id,
    leadId: row.lead_id,
    founderId: row.founder_id,
    painPoints: row.pain_points ?? [],
    objections: row.objections ?? [],
    featureRequests: row.feature_requests ?? [],
    nextSteps: row.next_steps ?? '',
    sentiment: row.sentiment,
    sentimentInferred: row.sentiment_inferred,
    rawText: row.raw_text,
    tags,
    tagGenerationFailed: row.tag_generation_failed,
    createdAt: row.created_at,
  };
}

function mapTagRow(row: TagRow): Tag {
  return {
    id: row.id,
    category: row.category,
    value: row.value,
  };
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
// LLM-based tag generation
// ---------------------------------------------------------------------------

interface GeneratedTags {
  painPoints: string[];
  objections: string[];
  featureRequests: string[];
}

/**
 * Use the LLM to extract structured tags from raw call note text.
 * Returns null if the LLM call fails.
 */
export async function generateTags(rawText: string): Promise<GeneratedTags | null> {
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert at extracting structured insights from sales call notes.
Extract pain points, objections, and feature requests from the text.
Return ONLY valid JSON with this exact structure:
{"painPoints": ["..."], "objections": ["..."], "featureRequests": ["..."]}
Each array should contain short, descriptive tag strings. If a category has no items, use an empty array.`,
        },
        { role: 'user', content: rawText },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = JSON.parse(content) as GeneratedTags;
    return {
      painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints : [],
      objections: Array.isArray(parsed.objections) ? parsed.objections : [],
      featureRequests: Array.isArray(parsed.featureRequests) ? parsed.featureRequests : [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM-based sentiment inference
// ---------------------------------------------------------------------------

/**
 * Infer sentiment from raw text using the LLM.
 * Returns 'neutral' as fallback if the LLM call fails.
 */
export async function inferSentiment(
  rawText: string,
): Promise<'positive' | 'neutral' | 'negative'> {
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Analyze the sentiment of the following sales call note. Respond with ONLY one word: positive, neutral, or negative.',
        },
        { role: 'user', content: rawText },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const content = completion.choices[0]?.message?.content?.trim().toLowerCase();
    if (content === 'positive' || content === 'neutral' || content === 'negative') {
      return content;
    }
    return 'neutral';
  } catch {
    return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/**
 * Submit a call note for a lead. Generates tags via LLM and infers sentiment
 * if not provided. Stores raw text and sets tagGenerationFailed on LLM failure.
 *
 * Requirements: 7.1, 7.2, 7.5, 7.6
 */
export async function submitCallNote(input: SubmitCallNoteInput): Promise<CallNote> {
  // Infer sentiment via LLM if not provided (Req 7.5)
  let sentiment = input.sentiment;
  let sentimentInferred = false;
  if (!sentiment) {
    sentiment = await inferSentiment(input.rawText);
    sentimentInferred = true;
  }

  // Generate tags via LLM (Req 7.2)
  const generatedTags = await generateTags(input.rawText);
  const tagGenerationFailed = generatedTags === null;

  // Merge user-provided structured data with LLM-generated tags
  const painPoints = [...(input.painPoints ?? []), ...(generatedTags?.painPoints ?? [])];
  const objections = [...(input.objections ?? []), ...(generatedTags?.objections ?? [])];
  const featureRequests = [
    ...(input.featureRequests ?? []),
    ...(generatedTags?.featureRequests ?? []),
  ];

  // Insert call note
  const noteResult = await query<CallNoteRow>(
    `INSERT INTO call_note (lead_id, founder_id, pain_points, objections, feature_requests,
                            next_steps, sentiment, sentiment_inferred, raw_text, tag_generation_failed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, lead_id, founder_id, pain_points, objections, feature_requests,
               next_steps, sentiment, sentiment_inferred, raw_text, tag_generation_failed, created_at`,
    [
      input.leadId,
      input.founderId,
      painPoints,
      objections,
      featureRequests,
      input.nextSteps ?? '',
      sentiment,
      sentimentInferred,
      input.rawText,
      tagGenerationFailed,
    ],
  );

  const noteRow = noteResult.rows[0];

  // Insert tags into the TAG table
  const tags: Tag[] = [];

  const tagEntries: Array<{ category: Tag['category']; value: string }> = [
    ...painPoints.map((v) => ({ category: 'pain_point' as const, value: v })),
    ...objections.map((v) => ({ category: 'objection' as const, value: v })),
    ...featureRequests.map((v) => ({ category: 'feature_request' as const, value: v })),
  ];

  for (const entry of tagEntries) {
    const tagResult = await query<TagRow>(
      `INSERT INTO tag (call_note_id, category, value)
       VALUES ($1, $2, $3)
       RETURNING id, call_note_id, category, value`,
      [noteRow.id, entry.category, entry.value],
    );
    tags.push(mapTagRow(tagResult.rows[0]));
  }

  return mapCallNoteRow(noteRow, tags);
}

/**
 * Get call notes for a lead in reverse chronological order.
 *
 * Requirements: 7.3
 */
export async function getCallNotes(leadId: string): Promise<CallNote[]> {
  const notesResult = await query<CallNoteRow>(
    `SELECT id, lead_id, founder_id, pain_points, objections, feature_requests,
            next_steps, sentiment, sentiment_inferred, raw_text, tag_generation_failed, created_at
     FROM call_note
     WHERE lead_id = $1
     ORDER BY created_at DESC`,
    [leadId],
  );

  const notes: CallNote[] = [];
  for (const row of notesResult.rows) {
    const tagsResult = await query<TagRow>(
      `SELECT id, call_note_id, category, value FROM tag WHERE call_note_id = $1`,
      [row.id],
    );
    notes.push(mapCallNoteRow(row, tagsResult.rows.map(mapTagRow)));
  }

  return notes;
}

/**
 * Get aggregated insights across all call notes for a founder.
 * Returns top pain points, objections, and feature requests sorted by frequency.
 *
 * Requirements: 7.4
 */
export async function getAggregatedInsights(founderId: string): Promise<AggregatedInsights> {
  const result = await query<{ category: string; value: string; count: string }>(
    `SELECT t.category, t.value, COUNT(*)::text AS count
     FROM tag t
     JOIN call_note cn ON cn.id = t.call_note_id
     WHERE cn.founder_id = $1
     GROUP BY t.category, t.value
     ORDER BY COUNT(*) DESC`,
    [founderId],
  );

  const painPoints: AggregatedInsight[] = [];
  const objections: AggregatedInsight[] = [];
  const featureRequests: AggregatedInsight[] = [];

  for (const row of result.rows) {
    const insight: AggregatedInsight = {
      category: row.category as AggregatedInsight['category'],
      value: row.value,
      count: parseInt(row.count, 10),
    };

    switch (row.category) {
      case 'pain_point':
        painPoints.push(insight);
        break;
      case 'objection':
        objections.push(insight);
        break;
      case 'feature_request':
        featureRequests.push(insight);
        break;
    }
  }

  return { painPoints, objections, featureRequests };
}
