'use client';

import { useOnlineStatus } from '@/lib/useErrorHandler';

export default function OfflineIndicator() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div className="offline-indicator" role="alert" aria-live="assertive">
      <span className="offline-icon">⚡</span>
      <span>You are offline. Some actions will be queued and retried when you reconnect.</span>
    </div>
  );
}
