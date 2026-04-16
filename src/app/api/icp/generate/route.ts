import { validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { generateICPSet, ICPGenerationError } from '@/services/icpGeneratorService';
import { getICPSet } from '@/services/icpProfileService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/icp/generate
 * Takes a product description, calls the AI generator to produce
 * an ICP_Set (2–8 profiles), and returns them for review (not persisted).
 * founderId is derived from the server-side session.
 *
 * On AI failure the route returns 502 and the previously saved ICP_Set
 * (if any) remains unchanged and is returned alongside the error.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { productDescription?: string; projectId?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  const desc = body.productDescription?.trim();
  if (!desc) {
    return validationError('productDescription is required', { productDescription: 'missing' });
  }

  const founderId = session.founderId;
  const projectId = body.projectId?.trim() || undefined;

  try {
    const result = await generateICPSet(desc, founderId);

    return NextResponse.json(result);
  } catch (err) {
    // Validation errors from the generator → 400
    if (err instanceof ICPGenerationError && err.code === 'VALIDATION_ERROR') {
      return validationError(err.message);
    }

    // AI / generation failure → 502, preserve existing ICP set
    const message = err instanceof Error ? err.message : 'Failed to generate ICP set';

    try {
      const existingSet = await getICPSet(founderId, projectId);
      if (existingSet && existingSet.profiles.length > 0) {
        return NextResponse.json(
          {
            error: 'GENERATION_FAILED',
            message,
            existingICPSet: existingSet,
          },
          { status: 502 },
        );
      }
    } catch {
      // Ignore — fall through to generic error response.
    }

    return NextResponse.json({ error: 'GENERATION_FAILED', message }, { status: 502 });
  }
}
