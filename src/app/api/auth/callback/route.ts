import { exchangeCodeForTokens, fetchUserInfo, setSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/callback
 * Handles the OIDC callback from ConsentKeys.
 * Exchanges the authorization code for tokens, fetches user info,
 * and sets an encrypted session cookie.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    const desc = searchParams.get('error_description') ?? 'Authentication failed';
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(desc)}`, request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/login?error=Missing+code+or+state', request.url));
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get('oidc_state')?.value;
  const codeVerifier = cookieStore.get('oidc_code_verifier')?.value;

  // Clean up OIDC cookies
  cookieStore.delete('oidc_state');
  cookieStore.delete('oidc_code_verifier');

  if (!savedState || state !== savedState) {
    return NextResponse.redirect(new URL('/login?error=Invalid+state', request.url));
  }

  if (!codeVerifier) {
    return NextResponse.redirect(new URL('/login?error=Missing+code+verifier', request.url));
  }

  try {
    const origin = process.env.NEXT_PUBLIC_BASE_URL ?? request.nextUrl.origin;
    const redirectUri = `${origin}/api/auth/callback`;

    const tokens = await exchangeCodeForTokens(code, redirectUri, codeVerifier);
    const userInfo = await fetchUserInfo(tokens.access_token);

    await setSession({
      sub: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });

    return NextResponse.redirect(new URL('/', request.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    console.error('[Auth Callback]', msg);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, request.url));
  }
}
