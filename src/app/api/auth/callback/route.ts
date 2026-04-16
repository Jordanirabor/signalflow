import { exchangeCodeForTokens, fetchUserInfo, setSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

function baseUrl(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? request.nextUrl.origin;
}

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
  const base = baseUrl(request);

  if (error) {
    const desc = searchParams.get('error_description') ?? 'Authentication failed';
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(desc)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${base}/login?error=Missing+code+or+state`);
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get('oidc_state')?.value;
  const codeVerifier = cookieStore.get('oidc_code_verifier')?.value;

  // Clean up OIDC cookies
  cookieStore.delete('oidc_state');
  cookieStore.delete('oidc_code_verifier');

  if (!savedState || state !== savedState) {
    return NextResponse.redirect(`${base}/login?error=Invalid+state`);
  }

  if (!codeVerifier) {
    return NextResponse.redirect(`${base}/login?error=Missing+code+verifier`);
  }

  try {
    const redirectUri = `${base}/api/auth/callback`;

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

    return NextResponse.redirect(`${base}/`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    console.error('[Auth Callback]', msg);
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(msg)}`);
  }
}
