'use client';

import type { Toast } from '@/lib/useErrorHandler';

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onLinkClick?: (linkTo: string) => void;
}

export default function ToastContainer({ toasts, onDismiss, onLinkClick }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          role={toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'}
        >
          <span className="toast-message">{toast.message}</span>
          {toast.linkTo && toast.linkLabel && onLinkClick && (
            <button
              type="button"
              className="toast-link"
              onClick={() => {
                onLinkClick(toast.linkTo!);
                onDismiss(toast.id);
              }}
            >
              {toast.linkLabel}
            </button>
          )}
          <button
            type="button"
            className="toast-dismiss"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
