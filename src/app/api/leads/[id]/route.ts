import { dbWriteError, validationError } from '@/lib/apiErrors';
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
 * Requirements: 2.2
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const lead = await getLeadById(id);
    if (!lead) {
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
 * Requirements: 10.2
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  let body: UpdateLeadInput;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  try {
    const lead = await updateLead(id, body);
    if (!lead) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(lead);
  } catch {
    return dbWriteError('Failed to update lead');
  }
}

/**
 * DELETE /api/leads/:id
 * Soft-delete a lead.
 *
 * Requirements: 10.5
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const lead = await softDeleteLead(id);
    if (!lead) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(lead);
  } catch {
    return dbWriteError('Failed to delete lead');
  }
}
