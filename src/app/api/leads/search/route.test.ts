import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn();
const mockSearchPeopleByName = vi.fn();

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock('@/services/peopleSearchService', () => ({
  searchPeopleByName: (...args: unknown[]) => mockSearchPeopleByName(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(query?: string): NextRequest {
  const url = query
    ? `http://localhost:3000/api/leads/search?q=${encodeURIComponent(query)}`
    : 'http://localhost:3000/api/leads/search';
  return new NextRequest(url, { method: 'GET' });
}

const SESSION = {
  founderId: 'founder-1',
  email: 'test@example.com',
  name: 'Test User',
  sub: 'sub-1',
  accessToken: 'token',
  expiresAt: Date.now() + 3600000,
};

// ---------------------------------------------------------------------------
// Import the route handler (after mocks are set up)
// ---------------------------------------------------------------------------

import { GET } from './route';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/leads/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(SESSION);
  });

  // Validates: Requirement 2.5
  it('returns 401 when no session', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(makeRequest('John'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  // Validates: Requirement 2.6
  it('returns 400 when q parameter is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  // Validates: Requirement 2.6
  it('returns 400 when q is shorter than 2 characters', async () => {
    const res = await GET(makeRequest('J'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  // Validates: Requirement 2.3
  it('returns 200 with empty results when Apollo is disabled', async () => {
    mockSearchPeopleByName.mockResolvedValue([]);
    const res = await GET(makeRequest('John'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toEqual([]);
  });

  // Validates: Requirement 2.1, 2.4
  it('returns 200 with results on successful search', async () => {
    const mockResults = [
      {
        name: 'John Doe',
        role: 'CTO',
        company: 'Acme Inc',
        industry: 'SaaS',
        geography: 'San Francisco, CA, US',
        email: 'john@acme.com',
      },
      {
        name: 'John Smith',
        role: 'VP Engineering',
        company: 'Beta Corp',
        industry: 'Fintech',
        geography: 'New York, NY, US',
        email: 'john@beta.com',
      },
    ];
    mockSearchPeopleByName.mockResolvedValue(mockResults);

    const res = await GET(makeRequest('John'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(2);
    expect(json.results[0].name).toBe('John Doe');
    expect(json.results[1].name).toBe('John Smith');
  });

  // Validates: Requirement 2.4
  it('returns 200 with empty results when searchPeopleByName throws', async () => {
    mockSearchPeopleByName.mockRejectedValue(new Error('Apollo API error'));
    const res = await GET(makeRequest('John'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toEqual([]);
  });

  it('calls searchPeopleByName with the query parameter', async () => {
    mockSearchPeopleByName.mockResolvedValue([]);
    await GET(makeRequest('Jane Doe'));
    expect(mockSearchPeopleByName).toHaveBeenCalledWith('Jane Doe');
  });
});
