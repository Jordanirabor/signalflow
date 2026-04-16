// ============================================================
// Google Maps (Serper.dev) — Source Adapter for Discovery
// ============================================================

import type { AnnotatedQuery, DiscoveredLeadData, ICP, SourceAdapter } from './types';

import { acquirePermit, recordRequest } from './rateLimiter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERPER_PLACES_URL = 'https://google.serper.dev/places';

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

export interface MapsBusinessListing {
  name: string;
  address: string;
  websiteUrl: string | null;
  phone: string | null;
  category: string | null;
}

/** Shape of a single place result from the Serper.dev Places API. */
interface SerperPlaceResult {
  title?: string;
  address?: string;
  website?: string;
  phoneNumber?: string;
  category?: string;
}

/** Top-level response from the Serper.dev Places API. */
interface SerperPlacesResponse {
  places?: SerperPlaceResult[];
}

// ---------------------------------------------------------------------------
// Exported Helper Functions (for testing)
// ---------------------------------------------------------------------------

/**
 * Normalize a business name: lowercase, trim, collapse whitespace.
 */
export function normalizeBusinessName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Normalize an address: lowercase, trim, collapse whitespace, remove trailing punctuation.
 */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,]+$/, '');
}

/**
 * Deduplicate business listings by normalized company name + address.
 * Keeps the first occurrence of each unique name+address pair.
 */
export function deduplicateBusinesses(businesses: MapsBusinessListing[]): MapsBusinessListing[] {
  const seen = new Set<string>();
  const deduped: MapsBusinessListing[] = [];

  for (const biz of businesses) {
    const key = `${normalizeBusinessName(biz.name)}|${normalizeAddress(biz.address)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(biz);
    }
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Call the Serper.dev Places API for a given search query.
 */
async function searchSerperPlaces(query: string, apiKey: string): Promise<MapsBusinessListing[]> {
  const response = await fetch(SERPER_PLACES_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query }),
  });

  if (!response.ok) {
    throw new Error(`Serper Places API returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as SerperPlacesResponse;
  const places = data.places ?? [];

  return places
    .filter((p): p is SerperPlaceResult & { title: string } => Boolean(p.title))
    .map((p) => ({
      name: p.title,
      address: p.address ?? '',
      websiteUrl: p.website ?? null,
      phone: p.phoneNumber ?? null,
      category: p.category ?? null,
    }));
}

/**
 * Convert a business listing into a DiscoveredLeadData.
 * Maps scraper discovers companies, not people — the name field is left empty
 * so the validation gate in the discovery engine can filter or flag it.
 * Enrichment may later resolve an actual contact name.
 */
function listingToLead(listing: MapsBusinessListing, icp: ICP): DiscoveredLeadData {
  // Extract a clean geography from the address (city, state/country only)
  const cleanGeo = extractCityRegion(listing.address) || icp.geography;

  return {
    name: '', // Maps discovers companies, not people — leave empty for validation
    role: icp.targetRole,
    company: cleanCompanyName(listing.name),
    industry: icp.industry,
    geography: cleanGeo,
    discoverySource: 'maps_scrape',
    companyDomain: listing.websiteUrl ?? undefined,
  };
}

/**
 * Extract city + state/region from a full street address.
 * e.g. "5132 NW 74th Ct, Coconut Creek, FL 33073" → "Coconut Creek, FL"
 * Falls back to the full address if parsing fails.
 */
function extractCityRegion(address: string): string {
  if (!address || !address.trim()) return '';

  // Try to parse US-style: ..., City, ST ZIP
  const usMatch = address.match(/,\s*([^,]+),\s*([A-Z]{2})\s+\d{5}/);
  if (usMatch) return `${usMatch[1].trim()}, ${usMatch[2]}`;

  // Try to parse international: last two comma-separated parts (city, country)
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    // Take the second-to-last and last parts, strip postal codes
    const region = parts[parts.length - 2].replace(/\s*\d{4,}.*$/, '').trim();
    const country = parts[parts.length - 1].replace(/\s*\d{4,}.*$/, '').trim();
    if (region && country) return `${region}, ${country}`;
  }

  return '';
}

/**
 * Clean up a company name from Maps results.
 * Removes marketing taglines after " - " separators.
 */
function cleanCompanyName(name: string): string {
  // Strip taglines: "Sapphire Software Solutions - Top Mobile App Dev" → "Sapphire Software Solutions"
  const dashIdx = name.indexOf(' - ');
  if (dashIdx > 0) {
    return name.slice(0, dashIdx).trim();
  }
  return name.trim();
}

// ---------------------------------------------------------------------------
// Google Maps Scraper — Source Adapter (Serper.dev)
// ---------------------------------------------------------------------------

export const mapsScraper: SourceAdapter = {
  name: 'maps_scrape',
  capabilities: ['discovery'],

  isEnabled(): boolean {
    if (!process.env.SERPER_API_KEY) return false;

    const envVal = process.env.MAPS_SCRAPING_ENABLED;
    // Default to true if not set
    return envVal === undefined || envVal === '' || envVal.toLowerCase() === 'true';
  },

  async discover(queries: AnnotatedQuery[], icp: ICP): Promise<DiscoveredLeadData[]> {
    if (!this.isEnabled()) {
      console.log('[MapsScraper] Adapter is disabled, skipping discovery');
      return [];
    }

    if (!icp.geography) {
      console.log('[MapsScraper] No geography in ICP, skipping maps discovery');
      return [];
    }

    const apiKey = process.env.SERPER_API_KEY!;
    const allListings: MapsBusinessListing[] = [];

    // Use maps-targeted queries or fall back to industry + geography
    const mapsQueries = queries.filter((q) => q.vector === 'maps');
    const searchTerms =
      mapsQueries.length > 0 ? mapsQueries.map((q) => q.query) : [icp.industry ?? 'business'];

    for (const term of searchTerms) {
      try {
        await acquirePermit('maps');

        const query = `${term} in ${icp.geography}`;
        const listings = await searchSerperPlaces(query, apiKey);
        recordRequest('maps');

        allListings.push(...listings);
      } catch (error) {
        console.error(
          `[MapsScraper] Error searching Serper places for "${term}":`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // Deduplicate by normalized company name + address
    const dedupedListings = deduplicateBusinesses(allListings);

    // Convert to DiscoveredLeadData
    const leads = dedupedListings.map((listing) => listingToLead(listing, icp));

    console.log(
      `[MapsScraper] Discovery complete: ${leads.length} businesses from ${allListings.length} raw listings`,
    );

    return leads;
  },
};
