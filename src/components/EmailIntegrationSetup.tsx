'use client';

import { FOUNDER_ID } from '@/lib/constants';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface EmailStatus {
  connected: boolean;
  email?: string;
  isActive?: boolean;
  lastSyncAt?: string;
  sendingName?: string;
  emailSignature?: string;
}

export default function EmailIntegrationSetup() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingName, setSendingName] = useState('');
  const [emailSignature, setEmailSignature] = useState('');
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/email/status?founderId=${FOUNDER_ID}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to load email status');
        return;
      }
      const data: EmailStatus = await res.json();
      setStatus(data);
      if (data.sendingName) setSendingName(data.sendingName);
      if (data.emailSignature) setEmailSignature(data.emailSignature);
    } catch {
      setError('Network error loading email status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function handleConnect() {
    setFeedback(null);
    try {
      const res = await fetch(`/api/oauth/gmail/authorize?founderId=${FOUNDER_ID}`);
      if (!res.ok) {
        setFeedback({ type: 'error', message: 'Failed to initiate Gmail OAuth flow' });
        return;
      }
      const data = await res.json();
      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl;
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network error initiating OAuth' });
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/pipeline/email?founderId=${FOUNDER_ID}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setFeedback({ type: 'error', message: 'Failed to disconnect email' });
        return;
      }
      setStatus({ connected: false });
      setSendingName('');
      setEmailSignature('');
      setFeedback({ type: 'success', message: 'Email disconnected successfully.' });
    } catch {
      setFeedback({ type: 'error', message: 'Network error disconnecting email' });
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/pipeline/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          founderId: FOUNDER_ID,
          sendingName,
          emailSignature,
        }),
      });
      if (!res.ok) {
        setFeedback({ type: 'error', message: 'Failed to save email settings' });
        return;
      }
      setFeedback({ type: 'success', message: 'Email settings saved.' });
    } catch {
      setFeedback({ type: 'error', message: 'Network error saving settings' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="email-setup-loading" role="status" aria-live="polite">
        Loading email integration...
      </div>
    );
  }

  if (error) {
    return (
      <div className="email-setup-error" role="alert">
        <p>{error}</p>
        <button type="button" className="action-btn" onClick={fetchStatus}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="email-integration-setup">
      <h2>Email Integration</h2>

      {/* Connection Status */}
      <section aria-label="Email connection status">
        <div className="connection-status">
          <span
            className={`status-indicator ${status?.connected ? 'status-connected' : 'status-disconnected'}`}
          />
          <span className="status-text">
            {status?.connected ? `Connected — ${status.email}` : 'Disconnected'}
          </span>
        </div>

        {!status?.connected ? (
          <button type="button" className="action-btn" onClick={handleConnect}>
            Connect Gmail
          </button>
        ) : (
          <button
            type="button"
            className="action-btn action-btn-danger"
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        )}
      </section>

      {/* Sending Name & Signature Config (only when connected) */}
      {status?.connected && (
        <form onSubmit={handleSaveSettings} className="email-settings-form" noValidate>
          <section aria-label="Email sending settings">
            <h3>Sending Settings</h3>

            <div className="form-field">
              <label htmlFor="email-sendingName">Sending Name</label>
              <input
                id="email-sendingName"
                type="text"
                value={sendingName}
                onChange={(e) => setSendingName(e.target.value)}
                placeholder="e.g. Jane Doe"
              />
              <span className="field-hint">
                Name displayed in the From field of outreach emails
              </span>
            </div>

            <div className="form-field">
              <label htmlFor="email-signature">Email Signature</label>
              <textarea
                id="email-signature"
                value={emailSignature}
                onChange={(e) => setEmailSignature(e.target.value)}
                placeholder="Your email signature..."
                rows={4}
              />
              <span className="field-hint">Appended to all outreach messages</span>
            </div>

            <button type="submit" className="action-btn" disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </section>
        </form>
      )}

      {feedback && (
        <div className={`form-feedback ${feedback.type}`} role="status">
          {feedback.message}
        </div>
      )}
    </div>
  );
}
