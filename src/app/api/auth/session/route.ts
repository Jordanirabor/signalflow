import { getSession } from '@/lib/auth';
import { NextResponse } from 'next/server';

/**
 * GET /api/auth/session
 * Returns the current user's session info (name, email, founderId).
 * Returns 401 if not authenticated.
 */
export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    name: session.name,
    email: session.email,
    founderId: session.founderId,
  });
}
