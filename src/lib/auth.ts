import crypto from 'crypto';
import { cookies } from 'next/headers';

// ConsentKeys OIDC configuration
const OIDC_ISSUER = 'https://api.consentkeys.com';
const AUTHORIZATION_ENDPOINT = `${OIDC_ISSUER}/auth`;
const TOKEN_ENDPOINT = `${OIDC_ISSUER}/token`;
const USERINFO_ENDPOINT = `${OIDC_ISSUER}/userinfo`;

const CLIENT_ID = process.env.CLIENT_ID!;
const CLIENT_SECRET = process.env.CLIENT_SECRET!;

const SESSION_COOKIE = 'sf_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface UserSession {
  sub: string;
  email?: string;
  name?: string;
  founderId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/**
 * Build the OIDC authorization URL with PKCE.
 */
export function buildAuthorizationUrl(
  redirectUri: string,
  state: string,
  codeVerifier: string,
): string {
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Fetch user info from the OIDC provider.
 */
export async function fetchUserInfo(
  accessToken: string,
): Promise<{ sub: string; email?: string; name?: string }> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`UserInfo request failed (${res.status})`);
  }

  return res.json();
}

/**
 * Encrypt session data for cookie storage.
 */
function encryptSession(session: UserSession): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

/**
 * Decrypt session data from cookie.
 */
function decryptSession(value: string): UserSession | null {
  try {
    const [ivB64, encB64, tagB64] = value.split('.');
    const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
    const iv = Buffer.from(ivB64, 'base64url');
    const encrypted = Buffer.from(encB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Store session in an encrypted httpOnly cookie.
 */
export async function setSession(session: UserSession): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, encryptSession(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Get the current session from the cookie.
 */
export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE);
  if (!cookie?.value) return null;
  const session = decryptSession(cookie.value);
  if (!session) return null;
  // Check expiry
  if (Date.now() > session.expiresAt) return null;
  return session;
}

/**
 * Clear the session cookie.
 */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Generate a random string for state/PKCE.
 */
export function generateRandom(length = 48): string {
  return crypto.randomBytes(length).toString('base64url');
}

import { query } from '@/lib/db';

/**
 * Find or create a founder record for the given OIDC user.
 * On first login, creates a new founder. On subsequent logins, returns the existing one.
 */
export async function findOrCreateFounder(userInfo: {
  sub: string;
  email?: string;
  name?: string;
}): Promise<string> {
  // Check if a founder with this oidc_sub already exists
  const existing = await query<{ id: string }>('SELECT id FROM founder WHERE oidc_sub = $1', [
    userInfo.sub,
  ]);

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Check if there's a founder with matching email but no oidc_sub (e.g., the seed record)
  if (userInfo.email) {
    const byEmail = await query<{ id: string }>('SELECT id FROM founder WHERE email = $1', [
      userInfo.email,
    ]);

    if (byEmail.rows.length > 0) {
      // Link the existing founder to this OIDC user
      await query('UPDATE founder SET oidc_sub = $1, name = COALESCE($2, name) WHERE id = $3', [
        userInfo.sub,
        userInfo.name,
        byEmail.rows[0].id,
      ]);
      return byEmail.rows[0].id;
    }
  }

  // Create a new founder
  const result = await query<{ id: string }>(
    `INSERT INTO founder (email, name, oidc_sub)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userInfo.email ?? `${userInfo.sub}@consentkeys.user`, userInfo.name ?? 'User', userInfo.sub],
  );

  return result.rows[0].id;
}
