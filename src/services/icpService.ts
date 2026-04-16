import { query } from '@/lib/db';
import type { EnrichedICP, ICP } from '@/types';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnrichedICPInput {
  founderId: string;
  productDescription?: string;
  valueProposition?: string;
  painPointsSolved?: string[];
  competitorContext?: string;
  idealCustomerCharacteristics?: string;
}

export interface ICPInput {
  founderId: string;
  targetRole?: string;
  industry?: string;
  companyStage?: string;
  geography?: string;
  customTags?: string[];
}

export interface ICPValidationResult {
  valid: boolean;
  missingFields: string[];
}

/**
 * Validate that required ICP fields are present.
 * Returns which required fields are missing.
 */
export function validateICP(input: ICPInput): ICPValidationResult {
  const missingFields: string[] = [];

  if (!input.targetRole || input.targetRole.trim() === '') {
    missingFields.push('targetRole');
  }
  if (!input.industry || input.industry.trim() === '') {
    missingFields.push('industry');
  }

  return { valid: missingFields.length === 0, missingFields };
}

/**
 * Get the current ICP for a founder.
 */
export async function getICP(founderId: string): Promise<ICP | null> {
  const result = await query<{
    id: string;
    founder_id: string;
    target_role: string;
    industry: string;
    company_stage: string | null;
    geography: string | null;
    custom_tags: string[] | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, founder_id, target_role, industry, company_stage, geography, custom_tags, created_at, updated_at
     FROM icp WHERE founder_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [founderId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    founderId: row.founder_id,
    targetRole: row.target_role,
    industry: row.industry,
    companyStage: row.company_stage ?? undefined,
    geography: row.geography ?? undefined,
    customTags: row.custom_tags ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create or update an ICP for a founder.
 * If an ICP already exists for the founder, it is updated; otherwise a new one is created.
 * Returns the saved ICP.
 */
export async function saveICP(
  input: ICPInput & { targetRole: string; industry: string },
): Promise<ICP> {
  const existing = await getICP(input.founderId);

  let row: {
    id: string;
    founder_id: string;
    target_role: string;
    industry: string;
    company_stage: string | null;
    geography: string | null;
    custom_tags: string[] | null;
    created_at: Date;
    updated_at: Date;
  };

  if (existing) {
    const result = await query<typeof row>(
      `UPDATE icp
       SET target_role = $1, industry = $2, company_stage = $3, geography = $4, custom_tags = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, founder_id, target_role, industry, company_stage, geography, custom_tags, created_at, updated_at`,
      [
        input.targetRole,
        input.industry,
        input.companyStage ?? null,
        input.geography ?? null,
        input.customTags ?? null,
        existing.id,
      ],
    );
    row = result.rows[0];
  } else {
    const result = await query<typeof row>(
      `INSERT INTO icp (founder_id, target_role, industry, company_stage, geography, custom_tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, founder_id, target_role, industry, company_stage, geography, custom_tags, created_at, updated_at`,
      [
        input.founderId,
        input.targetRole,
        input.industry,
        input.companyStage ?? null,
        input.geography ?? null,
        input.customTags ?? null,
      ],
    );
    row = result.rows[0];
  }

  return {
    id: row.id,
    founderId: row.founder_id,
    targetRole: row.target_role,
    industry: row.industry,
    companyStage: row.company_stage ?? undefined,
    geography: row.geography ?? undefined,
    customTags: row.custom_tags ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
// Pain-points validation
// ---------------------------------------------------------------------------

export interface PainPointsValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that painPointsSolved has 1–10 items, each ≤200 characters.
 */
export function validatePainPoints(painPoints: string[]): PainPointsValidationResult {
  const errors: string[] = [];

  if (painPoints.length === 0) {
    errors.push('painPointsSolved must contain at least 1 item');
  }
  if (painPoints.length > 10) {
    errors.push('painPointsSolved must contain at most 10 items');
  }

  painPoints.forEach((pp, i) => {
    if (pp.length === 0) {
      errors.push(`painPointsSolved[${i}] must be non-empty`);
    }
    if (pp.length > 200) {
      errors.push(`painPointsSolved[${i}] exceeds 200 characters (${pp.length})`);
    }
  });

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Enriched ICP row type (shared by getEnrichedICP / saveEnrichedICP)
// ---------------------------------------------------------------------------

type EnrichedICPRow = {
  id: string;
  founder_id: string;
  target_role: string;
  industry: string;
  company_stage: string | null;
  geography: string | null;
  custom_tags: string[] | null;
  product_description: string | null;
  value_proposition: string | null;
  pain_points_solved: string[] | null;
  competitor_context: string | null;
  ideal_customer_characteristics: string | null;
  enrichment_generated_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapRowToEnrichedICP(row: EnrichedICPRow): EnrichedICP {
  return {
    id: row.id,
    founderId: row.founder_id,
    targetRole: row.target_role,
    industry: row.industry,
    companyStage: row.company_stage ?? undefined,
    geography: row.geography ?? undefined,
    customTags: row.custom_tags ?? undefined,
    productDescription: row.product_description ?? undefined,
    valueProposition: row.value_proposition ?? undefined,
    painPointsSolved: row.pain_points_solved ?? undefined,
    competitorContext: row.competitor_context ?? undefined,
    idealCustomerCharacteristics: row.ideal_customer_characteristics ?? undefined,
    enrichmentGeneratedAt: row.enrichment_generated_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// getEnrichedICP
// ---------------------------------------------------------------------------

/**
 * Retrieve the full Enriched ICP for a founder, including enrichment fields.
 */
export async function getEnrichedICP(founderId: string): Promise<EnrichedICP | null> {
  const result = await query<EnrichedICPRow>(
    `SELECT id, founder_id, target_role, industry, company_stage, geography, custom_tags,
            product_description, value_proposition, pain_points_solved,
            competitor_context, ideal_customer_characteristics, enrichment_generated_at,
            created_at, updated_at
     FROM icp WHERE founder_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [founderId],
  );

  if (result.rows.length === 0) return null;
  return mapRowToEnrichedICP(result.rows[0]);
}

// ---------------------------------------------------------------------------
// saveEnrichedICP
// ---------------------------------------------------------------------------

/**
 * Store enriched fields on an existing ICP record.
 * The founder must already have an ICP row (created via saveICP).
 */
export async function saveEnrichedICP(input: EnrichedICPInput): Promise<EnrichedICP> {
  const existing = await getEnrichedICP(input.founderId);
  if (!existing) {
    throw new Error('No ICP found for founder. Create a base ICP first.');
  }

  // Validate pain points if provided
  if (input.painPointsSolved) {
    const validation = validatePainPoints(input.painPointsSolved);
    if (!validation.valid) {
      throw new Error(`Invalid painPointsSolved: ${validation.errors.join('; ')}`);
    }
  }

  const result = await query<EnrichedICPRow>(
    `UPDATE icp
     SET product_description = $1,
         value_proposition = $2,
         pain_points_solved = $3,
         competitor_context = $4,
         ideal_customer_characteristics = $5,
         enrichment_generated_at = $6,
         updated_at = NOW()
     WHERE id = $7
     RETURNING id, founder_id, target_role, industry, company_stage, geography, custom_tags,
               product_description, value_proposition, pain_points_solved,
               competitor_context, ideal_customer_characteristics, enrichment_generated_at,
               created_at, updated_at`,
    [
      input.productDescription ?? existing.productDescription ?? null,
      input.valueProposition ?? existing.valueProposition ?? null,
      input.painPointsSolved ?? existing.painPointsSolved ?? null,
      input.competitorContext ?? existing.competitorContext ?? null,
      input.idealCustomerCharacteristics ?? existing.idealCustomerCharacteristics ?? null,
      new Date(),
      existing.id,
    ],
  );

  return mapRowToEnrichedICP(result.rows[0]);
}

// ---------------------------------------------------------------------------
// generateEnrichedICP
// ---------------------------------------------------------------------------

/**
 * Call OpenAI to generate enrichment fields from a product description.
 * If an existingICP is provided, its base fields are preserved.
 * On AI failure, the existing Enriched ICP is preserved and a descriptive error is thrown.
 */
export async function generateEnrichedICP(
  productDescription: string,
  existingICP?: ICP,
): Promise<EnrichedICP> {
  if (!productDescription || productDescription.trim() === '') {
    throw new Error('productDescription is required');
  }

  const prompt = `Given the following product description, generate a structured JSON object with these fields:
- valueProposition: A concise value proposition (1-2 sentences)
- painPointsSolved: An array of 1-10 specific pain points the product solves (each ≤200 characters)
- competitorContext: A brief description of the competitive landscape and differentiation
- idealCustomerCharacteristics: A description of the ideal customer profile characteristics

Product description:
${productDescription.trim()}

${existingICP ? `Existing ICP context — target role: ${existingICP.targetRole}, industry: ${existingICP.industry}` : ''}

Respond ONLY with valid JSON, no markdown fences, no extra text.`;

  let parsed: {
    valueProposition?: string;
    painPointsSolved?: string[];
    competitorContext?: string;
    idealCustomerCharacteristics?: string;
  };

  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert B2B go-to-market strategist. Produce structured JSON for ICP enrichment.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!raw) {
      throw new Error('Empty response from LLM');
    }

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON from LLM: ${raw.slice(0, 200)}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const error = new Error(`Enriched ICP generation failed: ${message}`);
    (error as Error & { code: string }).code = 'ICP_ENRICHMENT_FAILED';
    throw error;
  }

  // Validate and clamp pain points
  let painPoints = parsed.painPointsSolved ?? [];
  // Filter empty entries
  painPoints = painPoints.filter((pp) => typeof pp === 'string' && pp.trim().length > 0);
  // Truncate items to 200 chars
  painPoints = painPoints.map((pp) => (pp.length > 200 ? pp.slice(0, 200) : pp));
  // Clamp to 1–10 items
  if (painPoints.length > 10) painPoints = painPoints.slice(0, 10);
  if (painPoints.length === 0) painPoints = ['General productivity improvement'];

  const validation = validatePainPoints(painPoints);
  if (!validation.valid) {
    throw new Error(`Generated pain points invalid: ${validation.errors.join('; ')}`);
  }

  // Build the enriched ICP, preserving base fields from existingICP
  const enriched: EnrichedICP = {
    id: existingICP?.id ?? '',
    founderId: existingICP?.founderId ?? '',
    targetRole: existingICP?.targetRole ?? '',
    industry: existingICP?.industry ?? '',
    companyStage: existingICP?.companyStage,
    geography: existingICP?.geography,
    customTags: existingICP?.customTags,
    createdAt: existingICP?.createdAt ?? new Date(),
    updatedAt: existingICP?.updatedAt ?? new Date(),
    productDescription: productDescription.trim(),
    valueProposition: parsed.valueProposition ?? '',
    painPointsSolved: painPoints,
    competitorContext: parsed.competitorContext ?? '',
    idealCustomerCharacteristics: parsed.idealCustomerCharacteristics ?? '',
    enrichmentGeneratedAt: new Date(),
  };

  return enriched;
}
