import { validationError } from '@/lib/apiErrors';
import { getAuthorizeUrl } from '@/services/emailIntegrationService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/oauth/gmail/authorize?founderId=<uuid>
 * Initiates the Gmail OAuth 2.0 flow by returning the authorization URL.
 *
 * Requirements: 9.1
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  const authorizeUrl = getAuthorizeUrl(founderId);
  return NextResponse.json({ authorizeUrl });
}
