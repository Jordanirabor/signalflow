'use client';

import { useEffect, useState } from 'react';

interface SessionData {
  founderId: string;
  name: string | null;
  email: string | null;
}

export interface UseSessionReturn {
  session: SessionData | null;
  isLoading: boolean;
  error: string | null;
}

interface SessionApiResponse {
  authenticated: boolean;
  founderId: string;
  name: string | null;
  email: string | null;
}

// Module-level promise cache for fetch deduplication across components
let cachedPromise: Promise<SessionData> | null = null;

export function clearSessionCache(): void {
  cachedPromise = null;
}

function fetchSession(): Promise<SessionData> {
  if (cachedPromise) {
    return cachedPromise;
  }

  cachedPromise = fetch('/api/auth/session')
    .then((res) => {
      if (res.status === 401) {
        window.location.href = '/login';
        // Return a never-resolving promise since we're redirecting
        return new Promise<SessionData>(() => {});
      }
      if (!res.ok) {
        throw new Error(`Session request failed with status ${res.status}`);
      }
      return res.json() as Promise<SessionApiResponse>;
    })
    .then((data) => {
      if (data === undefined) {
        // Redirecting — return a never-resolving promise
        return new Promise<SessionData>(() => {});
      }
      return {
        founderId: data.founderId,
        name: data.name ?? null,
        email: data.email ?? null,
      };
    })
    .catch((err) => {
      // Clear cache on error so subsequent calls can retry
      cachedPromise = null;
      throw err;
    });

  return cachedPromise;
}

export function useSession(): UseSessionReturn {
  const [session, setSession] = useState<SessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchSession()
      .then((data) => {
        if (!cancelled) {
          setSession(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load session');
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { session, isLoading, error };
}
