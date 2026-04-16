import type { ICPProfile } from '@/types';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateICPSetResult {
  profiles: Omit<ICPProfile, 'id' | 'createdAt' | 'updatedAt'>[];
  productDescription: string;
}

interface RawProfile {
  targetRole?: string;
  industry?: string;
  companyStage?: string;
  geography?: string;
  painPoints?: string[];
  buyingSignals?: string[];
  customTags?: string[];
}

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton — mirrors icpService.ts pattern)
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
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are an expert B2B go-to-market strategist. Given a product description, identify distinct buyer personas and produce structured JSON.';

function buildUserPrompt(productDescription: string): string {
  return `Given the following product description, generate between 2 and 8 distinct buyer personas (ICP profiles). Each persona should represent a different target role that would purchase or champion this product.

For each persona, provide:
- targetRole: the job title / role (must be unique across all personas)
- industry: the primary industry this persona operates in
- companyStage: (optional) e.g. "startup", "growth", "enterprise"
- geography: (optional) geographic focus if relevant
- painPoints: 2–10 specific pain points this persona experiences that the product solves (each ≤200 characters)
- buyingSignals: 1–5 observable indicators that this persona is in-market (each ≤200 characters)

Product description:
${productDescription}

Respond ONLY with a valid JSON array of persona objects. No markdown fences, no extra text.`;
}

// ---------------------------------------------------------------------------
// Validation & clamping helpers
// ---------------------------------------------------------------------------

function clampArray(arr: unknown[], min: number, max: number): string[] {
  const strings = arr
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => (s.length > 200 ? s.slice(0, 200) : s));
  if (strings.length > max) return strings.slice(0, max);
  return strings;
}

function isValidProfileShape(p: unknown): p is RawProfile {
  return typeof p === 'object' && p !== null && !Array.isArray(p);
}

/**
 * Parse the raw JSON from OpenAI into validated profile objects.
 * Returns null if the JSON is unparseable or doesn't contain an array.
 */
function parseAndValidateResponse(
  raw: string,
  founderId: string,
): Omit<ICPProfile, 'id' | 'createdAt' | 'updatedAt'>[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Accept either a top-level array or an object with a "profiles" key
  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'profiles' in parsed &&
    Array.isArray((parsed as Record<string, unknown>).profiles)
  ) {
    items = (parsed as Record<string, unknown>).profiles as unknown[];
  } else {
    return null;
  }

  const profiles: Omit<ICPProfile, 'id' | 'createdAt' | 'updatedAt'>[] = [];

  for (const item of items) {
    if (!isValidProfileShape(item)) continue;

    const targetRole = typeof item.targetRole === 'string' ? item.targetRole.trim() : '';
    const industry = typeof item.industry === 'string' ? item.industry.trim() : '';

    if (!targetRole || !industry) continue;

    let painPoints = clampArray(item.painPoints ?? [], 2, 10);
    // If AI returned fewer than 2 pain points, pad with a generic one
    if (painPoints.length < 2) {
      const defaults = [
        `Operational inefficiency in ${industry}`,
        `Scaling challenges for ${targetRole}`,
      ];
      while (painPoints.length < 2) {
        painPoints.push(defaults[painPoints.length] ?? `General challenge for ${targetRole}`);
      }
    }

    let buyingSignals = clampArray(item.buyingSignals ?? [], 1, 5);
    if (buyingSignals.length < 1) {
      buyingSignals = [`Actively hiring for ${targetRole}-adjacent roles`];
    }

    profiles.push({
      founderId,
      targetRole,
      industry,
      companyStage:
        typeof item.companyStage === 'string' ? item.companyStage.trim() || undefined : undefined,
      geography:
        typeof item.geography === 'string' ? item.geography.trim() || undefined : undefined,
      painPoints,
      buyingSignals,
      customTags: Array.isArray(item.customTags)
        ? item.customTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : undefined,
      isActive: true,
    });
  }

  return profiles.length > 0 ? profiles : null;
}

/**
 * Deduplicate profiles by targetRole (case-insensitive), keeping the first occurrence.
 */
function deduplicateByTargetRole(
  profiles: Omit<ICPProfile, 'id' | 'createdAt' | 'updatedAt'>[],
): Omit<ICPProfile, 'id' | 'createdAt' | 'updatedAt'>[] {
  const seen = new Set<string>();
  return profiles.filter((p) => {
    const key = p.targetRole.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main generator function
// ---------------------------------------------------------------------------

/**
 * Generate an ICP_Set (2–8 profiles) from a product description using OpenAI.
 *
 * - Validates the product description is non-empty / non-whitespace.
 * - Calls OpenAI and parses the JSON response.
 * - Clamps pain points to 2–10 per profile, buying signals to 1–5.
 * - Ensures all targetRoles are distinct across profiles.
 * - Retries once on invalid JSON or < 2 profiles.
 * - Returns profiles without persisting — the caller decides when to save.
 * - On AI failure, throws a descriptive error (preserving any existing ICP_Set).
 */
export async function generateICPSet(
  productDescription: string,
  founderId: string,
): Promise<GenerateICPSetResult> {
  // --- Input validation ---
  if (!productDescription || productDescription.trim().length === 0) {
    throw new ICPGenerationError(
      'Product description is required and cannot be empty or whitespace-only.',
      'VALIDATION_ERROR',
    );
  }

  const trimmedDescription = productDescription.trim();
  const client = getOpenAIClient();
  const userPrompt = buildUserPrompt(trimmedDescription);

  let lastError: string | undefined;

  // Attempt up to 2 times (initial + 1 retry)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 4000,
        temperature: 0.7,
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? '';
      if (!raw) {
        lastError = 'Empty response from LLM';
        continue;
      }

      const profiles = parseAndValidateResponse(raw, founderId);
      if (!profiles) {
        lastError = `Invalid JSON from LLM: ${raw.slice(0, 200)}`;
        continue;
      }

      // Deduplicate by targetRole
      let unique = deduplicateByTargetRole(profiles);

      // Clamp to 2–8 profiles
      if (unique.length > 8) {
        unique = unique.slice(0, 8);
      }

      if (unique.length < 2) {
        lastError = `LLM returned only ${unique.length} valid profile(s), need at least 2`;
        continue;
      }

      return {
        profiles: unique,
        productDescription: trimmedDescription,
      };
    } catch (err) {
      // If it's already our own error type, rethrow immediately (e.g. validation)
      if (err instanceof ICPGenerationError) throw err;

      lastError = err instanceof Error ? err.message : 'Unknown OpenAI error';
      // On the first attempt, retry; on the second, fall through to throw
      if (attempt === 0) continue;
    }
  }

  // Both attempts failed
  throw new ICPGenerationError(
    `ICP generation failed after retry: ${lastError ?? 'Unknown error'}`,
    'GENERATION_FAILED',
  );
}

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

export class ICPGenerationError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ICPGenerationError';
    this.code = code;
  }
}
