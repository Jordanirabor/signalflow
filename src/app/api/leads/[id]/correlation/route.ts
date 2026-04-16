import { dbWriteError } from '@/lib/apiErrors';
import { query } from '@/lib/db';
import { getLeadById } from '@/services/leadService';
import type { CorrelationBreakdown } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/leads/:id/correlation
 * Fetch a lead's Correlation Score breakdown.
 *
 * Requirements: 3.6
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const lead = await getLeadById(id);
    if (!lead) {
      return NextResponse.json(null, { status: 404 });
    }

    const result = await query<{
      correlation_score: number | null;
      correlation_breakdown: CorrelationBreakdown | null;
      correlation_flag: string | null;
    }>(
      `SELECT correlation_score, correlation_breakdown, correlation_flag
       FROM lead WHERE id = $1 AND is_deleted = false`,
      [id],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(null, { status: 404 });
    }

    const row = result.rows[0];
    if (row.correlation_score === null) {
      return NextResponse.json(null, { status: 404 });
    }

    return NextResponse.json({
      total: row.correlation_score,
      breakdown: row.correlation_breakdown,
      flag: row.correlation_flag,
    });
  } catch {
    return dbWriteError('Failed to retrieve correlation score');
  }
}
