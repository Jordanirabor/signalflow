import { clearSession } from '@/lib/auth';
import { NextResponse } from 'next/server';

/**
 * GET /api/auth/logout
 * Clears the session cookie and redirects to the login page.
 */
export async function GET() {
  await clearSession();
  return NextResponse.redirect(
    new URL('/login', process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'),
  );
}
