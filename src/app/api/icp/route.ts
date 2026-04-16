import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getICP, saveICP, validateICP, type ICPInput } from '@/services/icpService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/icp?founderId=<uuid>
 * Retrieve the current ICP for a founder.
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');

  if (!founderId) {
    return validationError('founderId query parameter is required', {
      founderId: 'missing',
    });
  }

  try {
    const icp = await getICP(founderId);
    if (!icp) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(icp);
  } catch {
    return dbWriteError('Failed to retrieve ICP');
  }
}

/**
 * POST /api/icp
 * Create or update an ICP. Body must include founderId, targetRole, industry.
 * On save, triggers async lead score recalculation.
 */
export async function POST(request: NextRequest) {
  let body: ICPInput;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  // Validate required ICP fields
  const validation = validateICP(body);
  if (!validation.valid) {
    const details: Record<string, string> = {};
    for (const field of validation.missingFields) {
      details[field] = 'missing';
    }
    return validationError(
      `Missing required fields: ${validation.missingFields.join(', ')}`,
      details,
    );
  }

  try {
    const icp = await saveICP(body as ICPInput & { targetRole: string; industry: string });

    // Fire-and-forget: trigger async lead score recalculation
    // The /api/leads/recalculate endpoint will be created in task 2.3
    const baseUrl = request.nextUrl.origin;
    fetch(`${baseUrl}/api/leads/recalculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ founderId: body.founderId }),
    }).catch(() => {
      // Silently ignore — recalculation endpoint may not exist yet
    });

    return NextResponse.json(icp, { status: existing(icp) ? 200 : 201 });
  } catch {
    return dbWriteError('Failed to save ICP');
  }
}

/**
 * Helper to determine if the ICP was an update (has older createdAt) vs new creation.
 * We use a simple heuristic: if createdAt !== updatedAt, it was updated.
 */
function existing(icp: { createdAt: Date; updatedAt: Date }): boolean {
  return new Date(icp.createdAt).getTime() !== new Date(icp.updatedAt).getTime();
}
