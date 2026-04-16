import { getSession } from '@/lib/auth';
import { getAuthorizeUrl } from '@/services/emailIntegrationService';
import { NextResponse } from 'next/server';

/**
 * GET /api/oauth/gmail/authorize
 * Initiates the Gmail OAuth 2.0 flow by returning the authorization URL.
 * founderId is derived from the server-side session.
 *
 * Requirements: 9.1
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authorizeUrl = getAuthorizeUrl(session.founderId);
  return NextResponse.json({ authorizeUrl });
}
