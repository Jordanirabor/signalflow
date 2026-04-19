'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
import { useCallback, useEffect, useState } from 'react';

type ProviderType = 'gmail' | 'smtp_imap';
type EncryptionType = 'tls' | 'starttls' | 'none';
type ConnectionStatus = 'connected' | 'disconnected' | 'error';

interface ProviderConfig {
  activeProvider: ProviderType;
  connectionStatus: ConnectionStatus;
  email?: string;
  error?: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  smtpEncryption: EncryptionType;
  fromName: string;
  replyToEmail: string;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  imapPassword: string;
  imapEncryption: EncryptionType;
  watchedFolders: string;
  pollIntervalMinutes: number;
  smtpVerified: boolean;
  imapVerified: boolean;
}

const DEFAULT_CONFIG: ProviderConfig = {
  activeProvider: 'gmail',
  connectionStatus: 'disconnected',
  smtpHost: '',
  smtpPort: 587,
  smtpUsername: '',
  smtpPassword: '',
  smtpEncryption: 'tls',
  fromName: '',
  replyToEmail: '',
  imapHost: '',
  imapPort: 993,
  imapUsername: '',
  imapPassword: '',
  imapEncryption: 'tls',
  watchedFolders: 'INBOX',
  pollIntervalMinutes: 5,
  smtpVerified: false,
  imapVerified: false,
};
function StatusDot({ status }: { status: ConnectionStatus }) {
  const colors: Record<ConnectionStatus, string> = {
    connected: 'bg-green-500',
    disconnected: 'bg-red-500',
    error: 'bg-yellow-500',
  };
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${colors[status]}`}
      aria-label={`Status: ${status}`}
    />
  );
}

export default function EmailProviderSettings() {
  const { session, isLoading: sessionLoading } = useSession();
  const [config, setConfig] = useState<ProviderConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [imapTesting, setImapTesting] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<ProviderType | null>(null);
  const [switching, setSwitching] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const [providerRes, statusRes] = await Promise.all([
        fetch('/api/pipeline/email/provider'),
        fetch('/api/pipeline/email/status'),
      ]);

      let statusData: {
        provider?: ProviderType;
        connected?: boolean;
        email?: string;
        error?: string;
      } = {};
      if (statusRes.ok) {
        statusData = await statusRes.json();
      }

      let connectionStatus: ConnectionStatus = 'disconnected';
      if (statusData.error) {
        connectionStatus = 'error';
      } else if (statusData.connected) {
        connectionStatus = 'connected';
      }

      if (providerRes.ok) {
        const data = await providerRes.json();
        if (data) {
          setConfig({
            activeProvider: statusData.provider ?? data.activeProvider ?? 'gmail',
            connectionStatus,
            email: statusData.email,
            error: statusData.error,
            smtpHost: data.smtpHost ?? '',
            smtpPort: data.smtpPort ?? 587,
            smtpUsername: data.smtpUsername ?? '',
            smtpPassword: data.smtpPassword ?? '',
            smtpEncryption: data.smtpEncryption ?? 'tls',
            fromName: data.fromName ?? '',
            replyToEmail: data.replyToEmail ?? '',
            imapHost: data.imapHost ?? '',
            imapPort: data.imapPort ?? 993,
            imapUsername: data.imapUsername ?? '',
            imapPassword: data.imapPassword ?? '',
            imapEncryption: data.imapEncryption ?? 'tls',
            watchedFolders: Array.isArray(data.watchedFolders)
              ? data.watchedFolders.join(', ')
              : (data.watchedFolders ?? 'INBOX'),
            pollIntervalMinutes: data.pollIntervalMinutes ?? 5,
            smtpVerified: data.smtpVerified ?? false,
            imapVerified: data.imapVerified ?? false,
          });
        } else {
          setConfig({
            ...DEFAULT_CONFIG,
            activeProvider: statusData.provider ?? 'gmail',
            connectionStatus,
            email: statusData.email,
            error: statusData.error,
          });
        }
      } else {
        setConfig({
          ...DEFAULT_CONFIG,
          activeProvider: statusData.provider ?? 'gmail',
          connectionStatus,
          email: statusData.email,
          error: statusData.error,
        });
      }
    } catch {
      setError('Network error loading provider configuration');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  async function handleTestSmtp() {
    setSmtpTesting(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch('/api/pipeline/email/test-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          smtpUsername: config.smtpUsername,
          smtpPassword: config.smtpPassword,
          smtpEncryption: config.smtpEncryption,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSmtpTestResult({ type: 'success', message: 'SMTP connection successful' });
        setConfig((prev) => ({ ...prev, smtpVerified: true }));
      } else {
        setSmtpTestResult({
          type: 'error',
          message: data.error ?? data.message ?? 'SMTP connection failed',
        });
      }
    } catch {
      setSmtpTestResult({ type: 'error', message: 'Network error testing SMTP connection' });
    } finally {
      setSmtpTesting(false);
    }
  }

  async function handleTestImap() {
    setImapTesting(true);
    setImapTestResult(null);
    try {
      const res = await fetch('/api/pipeline/email/test-imap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          imapUsername: config.imapUsername,
          imapPassword: config.imapPassword,
          imapEncryption: config.imapEncryption,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setImapTestResult({ type: 'success', message: 'IMAP connection successful' });
        setConfig((prev) => ({ ...prev, imapVerified: true }));
      } else {
        setImapTestResult({
          type: 'error',
          message: data.error ?? data.message ?? 'IMAP connection failed',
        });
      }
    } catch {
      setImapTestResult({ type: 'error', message: 'Network error testing IMAP connection' });
    } finally {
      setImapTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/pipeline/email/provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          smtpUsername: config.smtpUsername,
          smtpPassword: config.smtpPassword,
          smtpEncryption: config.smtpEncryption,
          fromEmail: config.smtpUsername,
          fromName: config.fromName,
          replyToEmail: config.replyToEmail || undefined,
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          imapUsername: config.imapUsername,
          imapPassword: config.imapPassword,
          imapEncryption: config.imapEncryption,
          watchedFolders: config.watchedFolders
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean),
          pollIntervalMinutes: config.pollIntervalMinutes,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFeedback({ type: 'error', message: data.message ?? 'Failed to save configuration' });
        return;
      }
      setFeedback({ type: 'success', message: 'Configuration saved successfully' });

      // If both connections are verified, auto-switch to smtp_imap
      if (config.smtpVerified && config.imapVerified) {
        try {
          const switchRes = await fetch('/api/pipeline/email/provider/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'smtp_imap' }),
          });
          if (switchRes.ok) {
            setFeedback({
              type: 'success',
              message: 'Configuration saved and SMTP/IMAP activated as your email provider.',
            });
          }
        } catch {
          // Switch failed — config is still saved, just not activated
        }
      }

      // Preserve the current view selection when reloading
      const currentProvider = config.activeProvider;
      await fetchConfig();
      setConfig((prev) => ({ ...prev, activeProvider: currentProvider }));
    } catch {
      setFeedback({ type: 'error', message: 'Network error saving configuration' });
    } finally {
      setSaving(false);
    }
  }

  function handleProviderChange(value: string) {
    const newProvider = value as ProviderType;
    if (newProvider !== config.activeProvider) {
      if (newProvider === 'smtp_imap' && !config.smtpVerified && !config.imapVerified) {
        // No verified config yet — just show the form without triggering the switch API
        setConfig((prev) => ({ ...prev, activeProvider: newProvider }));
        setFeedback({
          type: 'success',
          message:
            'Configure your SMTP and IMAP settings below, test both connections, then save to activate.',
        });
      } else {
        setPendingProvider(newProvider);
        setSwitchDialogOpen(true);
      }
    }
  }

  async function confirmProviderSwitch() {
    if (!pendingProvider) return;
    setSwitching(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/pipeline/email/provider/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: pendingProvider }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFeedback({
          type: 'error',
          message: data.message ?? 'Failed to switch provider',
        });
        return;
      }
      setConfig((prev) => ({ ...prev, activeProvider: pendingProvider }));
      setFeedback({
        type: 'success',
        message: `Switched to ${pendingProvider === 'gmail' ? 'Gmail OAuth' : 'Custom SMTP/IMAP'}`,
      });
      await fetchConfig();
    } catch {
      setFeedback({ type: 'error', message: 'Network error switching provider' });
    } finally {
      setSwitching(false);
      setSwitchDialogOpen(false);
      setPendingProvider(null);
    }
  }

  async function handleGmailConnect() {
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
          <Button variant="outline" size="sm" onClick={fetchConfig}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Email Provider Settings</h2>

      {/* Active Provider & Status */}
      <Card>
        <CardHeader>
          <CardTitle>Active Provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <StatusDot status={config.connectionStatus} />
            <Badge variant={config.connectionStatus === 'connected' ? 'default' : 'secondary'}>
              {config.activeProvider === 'gmail' ? 'Gmail OAuth' : 'Custom SMTP/IMAP'}
            </Badge>
            {config.email && <span className="text-sm text-muted-foreground">{config.email}</span>}
            {config.connectionStatus === 'error' && config.error && (
              <span className="text-sm text-destructive">{config.error}</span>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="provider-select" className="text-sm font-medium">
              Email Provider
            </label>
            <Select value={config.activeProvider} onValueChange={handleProviderChange}>
              <SelectTrigger id="provider-select">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gmail">Gmail OAuth</SelectItem>
                <SelectItem value="smtp_imap">Custom SMTP/IMAP</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Gmail OAuth Flow */}
      {config.activeProvider === 'gmail' && (
        <Card>
          <CardHeader>
            <CardTitle>Gmail OAuth Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant={config.connectionStatus === 'connected' ? 'default' : 'secondary'}>
                {config.connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
              </Badge>
              {config.email && (
                <span className="text-sm text-muted-foreground">{config.email}</span>
              )}
            </div>
            {config.connectionStatus !== 'connected' && (
              <Button onClick={handleGmailConnect}>Connect Gmail</Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Custom SMTP/IMAP Configuration */}
      {config.activeProvider === 'smtp_imap' && (
        <>
          {/* SMTP Section */}
          <Card>
            <CardHeader>
              <CardTitle>SMTP Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="smtp-host" className="text-sm font-medium">
                    Host
                  </label>
                  <Input
                    id="smtp-host"
                    value={config.smtpHost}
                    onChange={(e) => setConfig((prev) => ({ ...prev, smtpHost: e.target.value }))}
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="smtp-port" className="text-sm font-medium">
                    Port
                  </label>
                  <Input
                    id="smtp-port"
                    type="number"
                    value={config.smtpPort}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, smtpPort: parseInt(e.target.value) || 587 }))
                    }
                    placeholder="587"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="smtp-username" className="text-sm font-medium">
                    Username
                  </label>
                  <Input
                    id="smtp-username"
                    value={config.smtpUsername}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, smtpUsername: e.target.value }))
                    }
                    placeholder="user@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="smtp-password" className="text-sm font-medium">
                    Password
                  </label>
                  <Input
                    id="smtp-password"
                    type="password"
                    value={config.smtpPassword}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, smtpPassword: e.target.value }))
                    }
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="smtp-encryption" className="text-sm font-medium">
                  Encryption
                </label>
                <Select
                  value={config.smtpEncryption}
                  onValueChange={(value) =>
                    setConfig((prev) => ({ ...prev, smtpEncryption: value as EncryptionType }))
                  }
                >
                  <SelectTrigger id="smtp-encryption">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tls">TLS</SelectItem>
                    <SelectItem value="starttls">STARTTLS</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="smtp-from-name" className="text-sm font-medium">
                    From Name
                  </label>
                  <Input
                    id="smtp-from-name"
                    value={config.fromName}
                    onChange={(e) => setConfig((prev) => ({ ...prev, fromName: e.target.value }))}
                    placeholder="Jane Doe"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="smtp-reply-to" className="text-sm font-medium">
                    Reply-To Email
                  </label>
                  <Input
                    id="smtp-reply-to"
                    type="email"
                    value={config.replyToEmail}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, replyToEmail: e.target.value }))
                    }
                    placeholder="reply@example.com"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={handleTestSmtp} disabled={smtpTesting} variant="outline">
                  {smtpTesting ? 'Testing...' : 'Test SMTP Connection'}
                </Button>
                {config.smtpVerified && <Badge variant="default">Verified</Badge>}
              </div>
              {smtpTestResult && (
                <Alert variant={smtpTestResult.type === 'error' ? 'destructive' : 'default'}>
                  <AlertDescription>{smtpTestResult.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* IMAP Section */}
          <Card>
            <CardHeader>
              <CardTitle>IMAP Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="imap-host" className="text-sm font-medium">
                    Host
                  </label>
                  <Input
                    id="imap-host"
                    value={config.imapHost}
                    onChange={(e) => setConfig((prev) => ({ ...prev, imapHost: e.target.value }))}
                    placeholder="imap.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="imap-port" className="text-sm font-medium">
                    Port
                  </label>
                  <Input
                    id="imap-port"
                    type="number"
                    value={config.imapPort}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, imapPort: parseInt(e.target.value) || 993 }))
                    }
                    placeholder="993"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="imap-username" className="text-sm font-medium">
                    Username
                  </label>
                  <Input
                    id="imap-username"
                    value={config.imapUsername}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, imapUsername: e.target.value }))
                    }
                    placeholder="user@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="imap-password" className="text-sm font-medium">
                    Password
                  </label>
                  <Input
                    id="imap-password"
                    type="password"
                    value={config.imapPassword}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, imapPassword: e.target.value }))
                    }
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="imap-encryption" className="text-sm font-medium">
                  Encryption
                </label>
                <Select
                  value={config.imapEncryption}
                  onValueChange={(value) =>
                    setConfig((prev) => ({ ...prev, imapEncryption: value as EncryptionType }))
                  }
                >
                  <SelectTrigger id="imap-encryption">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tls">TLS</SelectItem>
                    <SelectItem value="starttls">STARTTLS</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label htmlFor="imap-folders" className="text-sm font-medium">
                  Watched Folders
                </label>
                <Input
                  id="imap-folders"
                  value={config.watchedFolders}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, watchedFolders: e.target.value }))
                  }
                  placeholder="INBOX, Sent"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated list of IMAP folders to monitor
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="imap-poll-interval" className="text-sm font-medium">
                  Poll Interval: {config.pollIntervalMinutes} min
                </label>
                <input
                  id="imap-poll-interval"
                  type="range"
                  min={1}
                  max={60}
                  value={config.pollIntervalMinutes}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      pollIntervalMinutes: parseInt(e.target.value),
                    }))
                  }
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1 min</span>
                  <span>60 min</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={handleTestImap} disabled={imapTesting} variant="outline">
                  {imapTesting ? 'Testing...' : 'Test IMAP Connection'}
                </Button>
                {config.imapVerified && <Badge variant="default">Verified</Badge>}
              </div>
              {imapTestResult && (
                <Alert variant={imapTestResult.type === 'error' ? 'destructive' : 'default'}>
                  <AlertDescription>{imapTestResult.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Save Button */}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </>
      )}

      {/* Feedback Alert */}
      {feedback && (
        <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'} role="status">
          <AlertTitle>{feedback.type === 'error' ? 'Error' : 'Success'}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}

      {/* Provider Switch Confirmation Dialog */}
      <Dialog open={switchDialogOpen} onOpenChange={setSwitchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch Email Provider</DialogTitle>
            <DialogDescription>
              Are you sure you want to switch to{' '}
              {pendingProvider === 'gmail' ? 'Gmail OAuth' : 'Custom SMTP/IMAP'}? All subsequent
              outreach emails will be sent through the new provider.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSwitchDialogOpen(false);
                setPendingProvider(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={confirmProviderSwitch} disabled={switching}>
              {switching ? 'Switching...' : 'Confirm Switch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
