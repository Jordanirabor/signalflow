import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import {
  getLeadById,
  softDeleteLead,
  updateLead,
  type UpdateLeadInput,
} from '@/services/leadService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/leads/:id
 * Retrieve a single lead by ID.
 *
 * Requirements: 2.2, 3.1, 3.2, 3.3, 3.4
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const lead = await getLeadById(id);
    if (!lead || lead.founderId !== session.founderId) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(lead);
  } catch {
    return dbWriteError('Failed to retrieve lead');
  }
}

/**
 * PATCH /api/leads/:id
 * Update a lead's fields.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 10.2
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  let body: UpdateLeadInput;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  // Validate steeringContext length
  if (body.steeringContext !== undefined && body.steeringContext.length > 1000) {
    return validationError('steeringContext must be 1000 characters or fewer');
  }

  try {
    const lead = await getLeadById(id);
    if (!lead || lead.founderId !== session.founderId) {
      return NextResponse.json(null, { status: 404 });
    }
    const updated = await updateLead(id, body);
    if (!updated) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch {
    return dbWriteError('Failed to update lead');
  }
}

/**
 * DELETE /api/leads/:id
 * Soft-delete a lead.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 10.5
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const lead = await getLeadById(id);
    if (!lead || lead.founderId !== session.founderId) {
      return NextResponse.json(null, { status: 404 });
    }
    const deleted = await softDeleteLead(id);
    if (!deleted) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(deleted);
  } catch {
    return dbWriteError('Failed to delete lead');
  }
}
