// ============================================================
// People Search Service — Multi-Source People-by-Name Search
// ============================================================
// Searches for people by name using Apollo (primary) with
// Serper.dev Google Search as a fallback. When Apollo is
// disabled or fails, Serper searches LinkedIn profiles to
// extract person details from snippets.
// ============================================================

export interface PersonSearchResult {
  name: string;
  role: string;
  company: string;
  industry: string;
  geography: string;
  email: string;
}

interface ApolloPersonResponse {
  people?: Array<{
    first_name?: string;
    last_name?: string;
    title?: string;
    email?: string;
    organization?: {
      name?: string;
      industry?: string;
    };
    city?: string;
    state?: string;
    country?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Serper.dev response types
// ---------------------------------------------------------------------------

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperResponse {
  organic?: SerperResult[];
}

// ---------------------------------------------------------------------------
// Apollo mapper
// ---------------------------------------------------------------------------

/**
 * Maps a raw Apollo person object to a PersonSearchResult.
 * Uses empty string for any missing field.
 */
export function mapApolloPerson(
  person: ApolloPersonResponse['people'] extends (infer T)[] | undefined ? T : never,
): PersonSearchResult {
  const firstName = person.first_name ?? '';
  const lastName = person.last_name ?? '';
  const name = [firstName, lastName].filter(Boolean).join(' ');

  const geography = [person.city, person.state, person.country].filter(Boolean).join(', ');

  return {
    name,
    role: person.title ?? '',
    company: person.organization?.name ?? '',
    industry: person.organization?.industry ?? '',
    geography,
    email: person.email ?? '',
  };
}

// ---------------------------------------------------------------------------
// Serper mapper — extract person details from LinkedIn search results
// ---------------------------------------------------------------------------

/**
 * Parse a LinkedIn snippet to extract name, role, and company.
 *
 * Typical LinkedIn snippet formats:
 *   "John Doe - CTO at Acme Inc · Experience: ..."
 *   "Jane Smith – Product Manager | Company · Location"
 */
export function mapSerperResult(result: SerperResult): PersonSearchResult | null {
  // Only process LinkedIn profile URLs
  if (!result.link.includes('linkedin.com/in/')) return null;

  const snippet = result.snippet ?? '';
  const title = result.title ?? '';

  // --- Extract name ---
  // Try snippet first (more reliable), then title
  let name = '';
  const separators = [' - ', ' – ', ' — ', ' | '];
  for (const sep of separators) {
    const idx = snippet.indexOf(sep);
    if (idx > 0 && idx < 80) {
      name = snippet.slice(0, idx).trim();
      break;
    }
  }
  if (!name) {
    // Try title: "John Doe - CTO - Company | LinkedIn"
    for (const sep of separators) {
      const idx = title.indexOf(sep);
      if (idx > 0 && idx < 80) {
        name = title.slice(0, idx).trim();
        break;
      }
    }
  }
  if (!name || name.length < 2) return null;

  // --- Extract role and company from the headline portion ---
  let role = '';
  let company = '';

  // Look for "Role at Company" pattern in snippet after the name
  for (const sep of separators) {
    const idx = snippet.indexOf(sep);
    if (idx > 0) {
      const afterName = snippet.slice(idx + sep.length).trim();
      // Stop at next separator or end
      const headlinePart = afterName.split(/[·|–—\n]/)[0].trim();

      const atMatch = headlinePart.match(/^(.+?)\s+at\s+(.+?)$/i);
      if (atMatch) {
        role = atMatch[1].trim();
        company = atMatch[2].trim();
      } else {
        role = headlinePart;
      }
      break;
    }
  }

  // Also try title for "Name - Role - Company | LinkedIn"
  if (!role) {
    const titleParts = title.split(/\s*[-–—|]\s*/);
    if (titleParts.length >= 3) {
      role = titleParts[1].trim();
      const companyPart = titleParts[2].trim();
      if (companyPart.toLowerCase() !== 'linkedin') {
        company = companyPart;
      }
    } else if (titleParts.length === 2 && !titleParts[1].toLowerCase().includes('linkedin')) {
      role = titleParts[1].trim();
    }
  }

  // Clean up "| LinkedIn" from company if present
  company = company.replace(/\s*\|\s*LinkedIn$/i, '').trim();

  return {
    name,
    role,
    company,
    industry: '',
    geography: '',
    email: '',
  };
}

// ---------------------------------------------------------------------------
// Apollo search (primary)
// ---------------------------------------------------------------------------

async function searchViaApollo(name: string): Promise<PersonSearchResult[]> {
  const apolloEnabled = process.env.APOLLO_ENABLED?.toLowerCase() === 'true';
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apolloEnabled || !apiKey) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  const response = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      q_keywords: name,
      per_page: 10,
    }),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[PeopleSearchService] Apollo API failed with status ${response.status}: ${response.statusText}. Body: ${errorBody.slice(0, 500)}`,
    );
    return [];
  }

  const data = (await response.json()) as ApolloPersonResponse;
  return (data.people ?? []).slice(0, 10).map(mapApolloPerson);
}

// ---------------------------------------------------------------------------
// Serper search (fallback) — searches Google for LinkedIn profiles
// ---------------------------------------------------------------------------

async function searchViaSerper(name: string): Promise<PersonSearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: `"${name}" site:linkedin.com/in`,
      num: 10,
    }),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[PeopleSearchService] Serper API failed with status ${response.status}: ${errorBody.slice(0, 200)}`,
    );
    return [];
  }

  const data = (await response.json()) as SerperResponse;
  const results = data.organic ?? [];

  const people: PersonSearchResult[] = [];
  const seenNames = new Set<string>();

  for (const result of results) {
    const person = mapSerperResult(result);
    if (!person) continue;

    const normalizedName = person.name.toLowerCase();
    if (seenNames.has(normalizedName)) continue;
    seenNames.add(normalizedName);

    people.push(person);
    if (people.length >= 10) break;
  }

  console.log(
    `[PeopleSearchService] Serper fallback returned ${people.length} results for "${name}"`,
  );
  return people;
}

// ---------------------------------------------------------------------------
// Public API — tries Apollo first, falls back to Serper
// ---------------------------------------------------------------------------

/**
 * Search for people by name.
 * Tries Apollo first (structured people database), then falls back to
 * Serper.dev Google Search (LinkedIn profile parsing) if Apollo returns
 * no results or is unavailable.
 * Returns up to 10 matching people. Returns [] on all errors.
 */
export async function searchPeopleByName(name: string): Promise<PersonSearchResult[]> {
  try {
    const apolloResults = await searchViaApollo(name);
    if (apolloResults.length > 0) return apolloResults;

    // Fallback to Serper if Apollo returned nothing
    return await searchViaSerper(name);
  } catch (error) {
    console.error(
      '[PeopleSearchService] Search failed:',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}
