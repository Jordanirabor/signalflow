import { buildAuthorizationUrl, generateRandom } from '@/lib/auth';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/login
 * Redirects the user to ConsentKeys OIDC authorization endpoint.
 */
export async function GET(request: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_BASE_URL ?? request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/callback`;

  const state = generateRandom(32);
  const codeVerifier = generateRandom(48);

  // Store state and code_verifier in short-lived cookies for the callback
  const cookieStore = await cookies();
  cookieStore.set('oidc_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });
  cookieStore.set('oidc_code_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  const authUrl = buildAuthorizationUrl(redirectUri, state, codeVerifier);
  return NextResponse.redirect(authUrl);
}
