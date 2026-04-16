import {
  dbWriteError,
  meetingDateRequiredError,
  reasonRequiredError,
  validationError,
} from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import {
  changeLeadStatus,
  getStatusHistory,
  isValidCRMStatus,
  validateStatusTransition,
  type ChangeStatusInput,
} from '@/services/crmService';
import { getLeadById } from '@/services/leadService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ leadId: string }> };

/**
 * PATCH /api/crm/:leadId/status
 * Change a lead's CRM status. Validates backward moves (require reason)
 * and Booked status (require meetingDate).
 *
 * Requirements: 6.1, 6.2, 6.4, 6.6
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { leadId } = await context.params;

  let body: { toStatus: string; reason?: string; meetingDate?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.toStatus) {
    return validationError('toStatus is required', { toStatus: 'missing' });
  }

  if (!isValidCRMStatus(body.toStatus)) {
    return validationError(
      `Invalid status: ${body.toStatus}. Must be one of: New, Contacted, Replied, Booked, Closed`,
      { toStatus: 'invalid' },
    );
  }

  // Fetch the lead to get current status
  let lead;
  try {
    lead = await getLeadById(leadId);
  } catch {
    return dbWriteError('Failed to retrieve lead');
  }

  if (!lead) {
    return NextResponse.json(null, { status: 404 });
  }

  const input: ChangeStatusInput = {
    leadId,
    toStatus: body.toStatus,
    reason: body.reason,
    meetingDate: body.meetingDate,
  };

  // Validate the transition
  const validation = validateStatusTransition(lead.crmStatus, input);
  if (!validation.valid) {
    if (validation.errorCode === 'REASON_REQUIRED') {
      return reasonRequiredError(validation.message!);
    }
    if (validation.errorCode === 'MEETING_DATE_REQUIRED') {
      return meetingDateRequiredError(validation.message!);
    }
    return validationError(validation.message!);
  }

  try {
    const result = await changeLeadStatus(input);
    if (!result) {
      return NextResponse.json(null, { status: 404 });
    }
    return NextResponse.json(result);
  } catch {
    return dbWriteError('Failed to update lead status');
  }
}

/**
 * GET /api/crm/:leadId/status
 * Get status change history for a lead.
 *
 * Requirements: 6.2
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { leadId } = await context.params;

  try {
    const history = await getStatusHistory(leadId);
    return NextResponse.json(history);
  } catch {
    return dbWriteError('Failed to retrieve status history');
  }
}
