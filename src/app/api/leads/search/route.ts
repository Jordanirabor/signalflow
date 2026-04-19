import { validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { searchPeopleByName } from '@/services/peopleSearchService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/leads/search?q=<name>
 * Search for people by name via Apollo. Returns matching results for autofill.
 * Returns empty results on any downstream error (graceful degradation).
 *
 * Requirements: 2.1, 2.3, 2.4, 2.5, 2.6
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get('q');
  if (!q || q.length < 2) {
    return validationError('Query parameter "q" must be at least 2 characters', { q: 'invalid' });
  }

  try {
    const results = await searchPeopleByName(q);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
