'use client';

import type { ApiError } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// Toast types
// ============================================================

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  linkTo?: string;
  linkLabel?: string;
  /** Auto-dismiss duration in ms. 0 = sticky. Default 5000. */
  duration?: number;
}

// ============================================================
// Offline / connectivity detection
// ============================================================

export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

// ============================================================
// Retry queue for offline actions
// ============================================================

type QueuedAction = () => Promise<unknown>;

export function useRetryQueue() {
  const queue = useRef<QueuedAction[]>([]);
  const online = useOnlineStatus();

  // Flush queue when connectivity returns
  useEffect(() => {
    if (online && queue.current.length > 0) {
      const pending = [...queue.current];
      queue.current = [];
      pending.forEach((fn) => fn().catch(() => {}));
    }
  }, [online]);

  const enqueue = useCallback((action: QueuedAction) => {
    queue.current.push(action);
  }, []);

  return { enqueue, queueLength: queue.current.length };
}

// ============================================================
// Toast manager hook
// ============================================================

let toastCounter = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `toast-${++toastCounter}`;
      const entry: Toast = { ...toast, id };
      setToasts((prev) => [...prev, entry]);

      const duration = toast.duration ?? 5000;
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  // Cleanup on unmount
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((timer) => clearTimeout(timer));
  }, []);

  return { toasts, show, dismiss };
}

// ============================================================
// Centralized API error → toast mapper
// ============================================================

export interface HandleApiErrorOptions {
  /** Callback to set field-level errors for 400 responses */
  setFieldErrors?: (details: Record<string, string>) => void;
  /** Show toast function from useToasts */
  showToast: (toast: Omit<Toast, 'id'>) => string;
}

/**
 * Maps an HTTP response to the appropriate user-facing feedback.
 * Returns true if the response was an error (caller should stop processing).
 */
export async function handleApiError(res: Response, opts: HandleApiErrorOptions): Promise<boolean> {
  if (res.ok) return false;

  let body: ApiError;
  try {
    body = await res.json();
  } catch {
    opts.showToast({ type: 'error', message: 'Unexpected server error. Please try again.' });
    return true;
  }

  switch (res.status) {
    case 400:
      // Inline field-level validation messages
      if (body.details && opts.setFieldErrors) {
        opts.setFieldErrors(body.details);
      }
      opts.showToast({ type: 'error', message: body.message });
      return true;

    case 409:
      // Duplicate lead — toast with link to existing lead
      opts.showToast({
        type: 'error',
        message: body.message,
        linkTo: body.details?.existingLeadId,
        linkLabel: 'View existing lead',
        duration: 8000,
      });
      return true;

    case 429:
      // Throttle exceeded — warning banner with capacity info
      opts.showToast({
        type: 'warning',
        message: body.message,
        duration: 10000,
      });
      return true;

    case 500:
    default:
      // Generic error toast — form state is retained by the caller
      opts.showToast({
        type: 'error',
        message:
          body.message || 'Something went wrong. Your input has been preserved — please try again.',
        duration: 7000,
      });
      return true;
  }
}

/**
 * Wraps a fetch call with network-failure detection.
 * On network error, shows an offline toast and optionally queues the action for retry.
 */
export async function safeFetch(
  input: RequestInfo,
  init: RequestInit | undefined,
  opts: {
    showToast: (toast: Omit<Toast, 'id'>) => string;
    enqueue?: (action: QueuedAction) => void;
  },
): Promise<Response | null> {
  try {
    return await fetch(input, init);
  } catch {
    opts.showToast({
      type: 'warning',
      message: 'You appear to be offline. The action will be retried when connectivity returns.',
      duration: 0, // sticky until dismissed or reconnect
    });
    if (opts.enqueue) {
      opts.enqueue(() => fetch(input, init));
    }
    return null;
  }
}
