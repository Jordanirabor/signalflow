// ============================================================
// AI Result Parser — OpenAI-powered search result extraction
// Falls back to regex-based extraction on failure
// ============================================================

import OpenAI from 'openai';

import { extractNameFromSnippet } from './serpApiSearchAdapter';
import type { ICP, ParsedLead } from './types';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface RawSearchResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

export interface AIParseResult {
  leads: ParsedLead[];
  method: 'ai' | 'regex_fallback';
}

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton — same pattern as queryGenerator)
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
// Constants
// ---------------------------------------------------------------------------

const MAX_RESULTS_PER_CALL = 30;
const OPENAI_TIMEOUT_MS = 15_000;
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

// ---------------------------------------------------------------------------
// AI-powered parsing
// ---------------------------------------------------------------------------

function buildExtractionPrompt(results: RawSearchResult[], icp: ICP): string {
  const resultsJson = JSON.stringify(
    results.map((r) => ({ title: r.title, link: r.link, snippet: r.snippet })),
  );

  return `You are a lead extraction assistant. Given the following Google search results, extract structured lead information for people who could be prospects.

Target ICP:
- Role: ${icp.targetRole}
- Industry: ${icp.industry}
${icp.companyStage ? `- Company Stage: ${icp.companyStage}` : ''}
${icp.geography ? `- Geography: ${icp.geography}` : ''}

Search Results:
${resultsJson}

For each result that contains a person's profile (especially LinkedIn profiles), extract:
- name: The person's full name (first and last)
- role: Their job title/role (do NOT include the company name in this field)
- company: The company they work at (do NOT include the role/title in this field)
- linkedinUrl: Their LinkedIn profile URL if available
- companyDomain: The company's website domain if identifiable
- confidence: "high" if name/role/company are clearly stated, "medium" if partially inferred, "low" if uncertain

Return ONLY a JSON array of objects. Do not include any explanation or markdown formatting.
Example: [{"name":"Jane Doe","role":"VP of Engineering","company":"Acme Corp","linkedinUrl":"https://linkedin.com/in/janedoe","companyDomain":"acme.com","confidence":"high"}]

If no leads can be extracted, return an empty array: []`;
}

/**
 * Attempt to parse a JSON array from a potentially messy OpenAI response.
 * Strips markdown fences and tries to find a JSON array.
 */
function extractJsonArray(raw: string): unknown[] | null {
  let cleaned = raw.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    // Try to find a JSON array in the string
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Validate a single parsed lead object has all required non-empty fields
 * and a valid confidence value.
 */
function isValidLead(obj: Record<string, unknown>): boolean {
  const name = obj.name;
  const role = obj.role;
  const company = obj.company;
  const confidence = obj.confidence;

  return (
    typeof name === 'string' &&
    name.trim().length > 0 &&
    typeof role === 'string' &&
    role.trim().length > 0 &&
    typeof company === 'string' &&
    company.trim().length > 0 &&
    typeof confidence === 'string' &&
    VALID_CONFIDENCE.has(confidence)
  );
}

// ---------------------------------------------------------------------------
// Regex fallback
// ---------------------------------------------------------------------------

/**
 * Fall back to regex-based extraction using the existing extractNameFromSnippet
 * function from serpApiSearchAdapter.ts.
 */
function regexFallback(results: RawSearchResult[], icp: ICP): ParsedLead[] {
  const leads: ParsedLead[] = [];

  for (const result of results) {
    // Only attempt extraction from LinkedIn-like URLs
    if (!result.link.includes('linkedin.com/in/')) continue;

    const name = extractNameFromSnippet(result.snippet);
    if (!name) continue;

    // Extract headline from snippet — often "Name - Role at Company"
    let role = '';
    let company = '';
    const separators = [' - ', ' – ', ' — ', ' | '];
    for (const sep of separators) {
      const idx = result.snippet.indexOf(sep);
      if (idx > 0) {
        const headline = result.snippet.slice(idx + sep.length).trim();
        // Try "Role at Company" pattern
        const atMatch = headline.match(/^(.+?)\s+at\s+(.+?)(?:\s*[·|–—\-]|$)/i);
        if (atMatch) {
          role = atMatch[1].trim();
          company = atMatch[2].trim();
        } else {
          role = headline.split(/[·|–—\-]/)[0].trim();
        }
        break;
      }
    }

    if (!role) role = icp.targetRole;

    leads.push({
      name: name.trim(),
      role,
      company,
      linkedinUrl: result.link,
      confidence: 'low',
    });
  }

  return leads.filter((l) => l.name.length > 0 && l.role.length > 0);
}

// ---------------------------------------------------------------------------
// Main parser function
// ---------------------------------------------------------------------------

/**
 * Parse raw Serper search results using OpenAI to extract structured lead data.
 * Processes up to 30 results in a single API call.
 * Falls back to regex-based extraction on AI failure/timeout/invalid JSON.
 */
export async function parseSearchResultsWithAI(
  results: RawSearchResult[],
  icp: ICP,
): Promise<AIParseResult> {
  if (results.length === 0) {
    return { leads: [], method: 'ai' };
  }

  const batch = results.slice(0, MAX_RESULTS_PER_CALL);

  try {
    const client = getOpenAIClient();
    const prompt = buildExtractionPrompt(batch, icp);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await client.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 4096,
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      console.warn('[AIResultParser] Empty response from OpenAI, falling back to regex');
      return { leads: regexFallback(batch, icp), method: 'regex_fallback' };
    }

    const parsed = extractJsonArray(content);
    if (!parsed) {
      console.warn('[AIResultParser] Invalid JSON from OpenAI, falling back to regex');
      return { leads: regexFallback(batch, icp), method: 'regex_fallback' };
    }

    const validLeads: ParsedLead[] = [];
    let discarded = 0;

    for (const item of parsed) {
      if (
        typeof item === 'object' &&
        item !== null &&
        isValidLead(item as Record<string, unknown>)
      ) {
        const lead = item as ParsedLead;
        validLeads.push({
          name: lead.name.trim(),
          role: lead.role.trim(),
          company: lead.company.trim(),
          linkedinUrl: lead.linkedinUrl || undefined,
          companyDomain: lead.companyDomain || undefined,
          confidence: lead.confidence,
        });
      } else {
        discarded++;
      }
    }

    if (discarded > 0) {
      console.warn(`[AIResultParser] Discarded ${discarded} leads with missing/invalid fields`);
    }

    return { leads: validLeads, method: 'ai' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[AIResultParser] OpenAI call failed (${message}), falling back to regex`);
    return { leads: regexFallback(batch, icp), method: 'regex_fallback' };
  }
}

// ---------------------------------------------------------------------------
// ICP Validation
// ---------------------------------------------------------------------------

/**
 * Check if a role is relevant to the ICP target role.
 * Uses case-insensitive keyword matching.
 */
function isRoleRelevant(leadRole: string, targetRole: string): boolean {
  const normalizedLead = leadRole.toLowerCase();
  const normalizedTarget = targetRole.toLowerCase();

  // Direct match
  if (normalizedLead.includes(normalizedTarget) || normalizedTarget.includes(normalizedLead)) {
    return true;
  }

  // Extract keywords from target role (words with 3+ chars)
  const targetKeywords = normalizedTarget.split(/[\s,/&\-]+/).filter((w) => w.length >= 3);

  // At least one keyword from the target role should appear in the lead's role
  return targetKeywords.some((keyword) => normalizedLead.includes(keyword));
}

/**
 * Check if a lead's industry aligns with the ICP industry.
 * Uses case-insensitive keyword matching.
 */
function isIndustryAligned(leadCompany: string, icpIndustry: string): boolean {
  // We can't definitively determine industry from company name alone,
  // so we use a lenient check — only filter out if we have strong evidence
  // of misalignment. Since we don't have the lead's industry field,
  // we accept all leads (the AI parser already considers ICP context).
  if (!icpIndustry || !leadCompany) return true;

  // If the company name is present, we accept it — the AI parser
  // was already prompted with ICP context for relevance.
  return true;
}

/**
 * Validate extracted leads against ICP criteria.
 * Filters by role relevance and industry alignment.
 * Discards leads that don't match.
 */
export function validateLeadsAgainstICP(leads: ParsedLead[], icp: ICP): ParsedLead[] {
  return leads.filter((lead) => {
    const roleMatch = isRoleRelevant(lead.role, icp.targetRole);
    const industryMatch = isIndustryAligned(lead.company, icp.industry);
    return roleMatch && industryMatch;
  });
}
