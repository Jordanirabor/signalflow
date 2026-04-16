import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getConnectionStatus } from '@/services/emailIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/email/status?founderId=<uuid>
 * Returns the current email connection status.
 *
 * Requirements: 9.5
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const status = await getConnectionStatus(founderId);
    return NextResponse.json(status);
  } catch {
    return dbWriteError('Failed to retrieve email connection status');
  }
}
