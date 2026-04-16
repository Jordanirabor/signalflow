'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/useSession';
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
  const { session, isLoading: sessionLoading } = useSession();
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
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/pipeline/email/status');
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
  }, [session]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function handleConnect() {
    setFeedback(null);
    try {
      const res = await fetch('/api/oauth/gmail/authorize');
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
      const res = await fetch('/api/pipeline/email', {
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

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={fetchStatus}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Email Integration</h2>

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle>Connection Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge variant={status?.connected ? 'default' : 'secondary'}>
              {status?.connected ? 'Connected' : 'Disconnected'}
            </Badge>
            {status?.connected && status.email && (
              <span className="text-sm text-muted-foreground">{status.email}</span>
            )}
          </div>

          {!status?.connected ? (
            <Button onClick={handleConnect}>Connect Gmail</Button>
          ) : (
            <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Sending Name & Signature Config (only when connected) */}
      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle>Sending Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveSettings} className="space-y-4" noValidate>
              <div className="space-y-2">
                <label htmlFor="email-sendingName" className="text-sm font-medium">
                  Sending Name
                </label>
                <Input
                  id="email-sendingName"
                  value={sendingName}
                  onChange={(e) => setSendingName(e.target.value)}
                  placeholder="e.g. Jane Doe"
                />
                <p className="text-xs text-muted-foreground">
                  Name displayed in the From field of outreach emails
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="email-signature" className="text-sm font-medium">
                  Email Signature
                </label>
                <Textarea
                  id="email-signature"
                  value={emailSignature}
                  onChange={(e) => setEmailSignature(e.target.value)}
                  placeholder="Your email signature..."
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">Appended to all outreach messages</p>
              </div>

              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {feedback && (
        <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'} role="status">
          <AlertTitle>{feedback.type === 'error' ? 'Error' : 'Success'}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
