import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getICP, saveICP, validateICP, type ICPInput } from '@/services/icpService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/icp
 * Retrieve the current ICP for the authenticated founder.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const icp = await getICP(session.founderId);
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
 * Create or update an ICP. Body must include targetRole, industry.
 * founderId is derived from the server-side session.
 * On save, triggers async lead score recalculation.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: ICPInput;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  // Override any client-supplied founderId with session value
  body.founderId = session.founderId;

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
    const baseUrl = request.nextUrl.origin;
    fetch(`${baseUrl}/api/leads/recalculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ founderId: session.founderId }),
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
