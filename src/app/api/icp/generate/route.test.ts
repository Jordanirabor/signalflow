import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGenerateICPSet = vi.fn();
const mockGetICPSet = vi.fn();

vi.mock('@/services/icpGeneratorService', () => {
  class ICPGenerationError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'ICPGenerationError';
      this.code = code;
    }
  }
  return {
    generateICPSet: (...args: unknown[]) => mockGenerateICPSet(...args),
    ICPGenerationError,
  };
});

vi.mock('@/services/icpProfileService', () => ({
  getICPSet: (...args: unknown[]) => mockGetICPSet(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/icp/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const generatedResult = {
  profiles: [
    {
      founderId: 'founder-1',
      targetRole: 'CTO',
      industry: 'SaaS',
      painPoints: ['Slow deployments', 'Poor code quality'],
      buyingSignals: ['Hiring DevOps engineers'],
      isActive: true,
    },
    {
      founderId: 'founder-1',
      targetRole: 'VP Engineering',
      industry: 'SaaS',
      painPoints: ['Team scaling issues', 'Technical debt'],
      buyingSignals: ['Expanding engineering team'],
      isActive: true,
    },
  ],
  productDescription: 'AI code review platform',
};

const existingICPSet = {
  founderId: 'founder-1',
  profiles: [
    {
      id: 'profile-1',
      founderId: 'founder-1',
      targetRole: 'CTO',
      industry: 'SaaS',
      painPoints: ['Old pain point'],
      buyingSignals: ['Old signal'],
      isActive: true,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  ],
  activeCount: 1,
};

// ---------------------------------------------------------------------------
// Import the route handler (after mocks are set up)
// ---------------------------------------------------------------------------

import { POST } from './route';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/icp/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/icp/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when productDescription is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('VALIDATION_ERROR');
    expect(json.details?.productDescription).toBe('missing');
  });

  it('returns 400 when productDescription is empty string', async () => {
    const res = await POST(makeRequest({ productDescription: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns generated ICP set on success', async () => {
    mockGenerateICPSet.mockResolvedValue(generatedResult);

    const res = await POST(
      makeRequest({ productDescription: 'AI code review platform', founderId: 'founder-1' }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.profiles).toHaveLength(2);
    expect(json.productDescription).toBe('AI code review platform');
    expect(json.profiles[0].targetRole).toBe('CTO');
    expect(json.profiles[1].targetRole).toBe('VP Engineering');
  });

  it('calls generateICPSet with trimmed description and founderId', async () => {
    mockGenerateICPSet.mockResolvedValue(generatedResult);

    await POST(
      makeRequest({ productDescription: '  AI code review platform  ', founderId: 'founder-1' }),
    );

    expect(mockGenerateICPSet).toHaveBeenCalledWith('AI code review platform', 'founder-1');
  });

  it('uses "anonymous" as founderId when not provided', async () => {
    mockGenerateICPSet.mockResolvedValue(generatedResult);

    await POST(makeRequest({ productDescription: 'AI code review platform' }));

    expect(mockGenerateICPSet).toHaveBeenCalledWith('AI code review platform', 'anonymous');
  });

  it('returns 502 with existing ICP set on AI failure when founderId provided', async () => {
    mockGenerateICPSet.mockRejectedValue(new Error('OpenAI timeout'));
    mockGetICPSet.mockResolvedValue(existingICPSet);

    const res = await POST(
      makeRequest({ productDescription: 'AI code review platform', founderId: 'founder-1' }),
    );
    expect(res.status).toBe(502);

    const json = await res.json();
    expect(json.error).toBe('GENERATION_FAILED');
    expect(json.message).toContain('OpenAI timeout');
    expect(json.existingICPSet).toBeDefined();
    expect(json.existingICPSet.profiles).toHaveLength(1);
    expect(json.existingICPSet.profiles[0].targetRole).toBe('CTO');
  });

  it('returns 502 without existing ICP set on AI failure when no founderId', async () => {
    mockGenerateICPSet.mockRejectedValue(new Error('OpenAI timeout'));

    const res = await POST(makeRequest({ productDescription: 'AI code review platform' }));
    expect(res.status).toBe(502);

    const json = await res.json();
    expect(json.error).toBe('GENERATION_FAILED');
    expect(json.existingICPSet).toBeUndefined();
  });

  it('returns 502 generic error when founderId provided but no existing profiles', async () => {
    mockGenerateICPSet.mockRejectedValue(new Error('AI failed'));
    mockGetICPSet.mockResolvedValue({ founderId: 'founder-1', profiles: [], activeCount: 0 });

    const res = await POST(
      makeRequest({ productDescription: 'AI code review platform', founderId: 'founder-1' }),
    );
    expect(res.status).toBe(502);

    const json = await res.json();
    expect(json.error).toBe('GENERATION_FAILED');
    expect(json.existingICPSet).toBeUndefined();
  });

  it('returns 502 generic error when getICPSet also fails', async () => {
    mockGenerateICPSet.mockRejectedValue(new Error('AI failed'));
    mockGetICPSet.mockRejectedValue(new Error('DB down'));

    const res = await POST(
      makeRequest({ productDescription: 'AI code review platform', founderId: 'founder-1' }),
    );
    expect(res.status).toBe(502);

    const json = await res.json();
    expect(json.error).toBe('GENERATION_FAILED');
    expect(json.existingICPSet).toBeUndefined();
  });

  it('returns 400 for ICPGenerationError with VALIDATION_ERROR code', async () => {
    // Import the mocked ICPGenerationError
    const { ICPGenerationError } = await import('@/services/icpGeneratorService');
    mockGenerateICPSet.mockRejectedValue(
      new ICPGenerationError('Product description is required', 'VALIDATION_ERROR'),
    );

    const res = await POST(makeRequest({ productDescription: 'test', founderId: 'founder-1' }));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe('VALIDATION_ERROR');
  });
});
