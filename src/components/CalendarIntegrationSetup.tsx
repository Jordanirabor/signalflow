'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
import type { AvailabilityWindow } from '@/types';
import { useCallback, useEffect, useState } from 'react';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface CalendarStatus {
  connected: boolean;
  calendarId?: string;
  isActive?: boolean;
}

interface DayConfig {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';

function buildDefaultDays(): DayConfig[] {
  return DAY_LABELS.map((_, i) => ({
    enabled: i >= 1 && i <= 5, // Mon–Fri
    startTime: '09:00',
    endTime: '17:00',
  }));
}

export default function CalendarIntegrationSetup() {
  const { session, isLoading: sessionLoading } = useSession();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<DayConfig[]>(buildDefaultDays);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
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
      const [statusRes, windowsRes] = await Promise.all([
        fetch('/api/pipeline/calendar/status'),
        fetch('/api/pipeline/calendar'),
      ]);

      if (!statusRes.ok) {
        const err = await statusRes.json();
        setError(err.message ?? 'Failed to load calendar status');
        return;
      }

      const statusData: CalendarStatus = await statusRes.json();
      setStatus(statusData);

      // Load availability windows if available
      if (windowsRes.ok) {
        const windows: AvailabilityWindow[] = await windowsRes.json();
        if (windows.length > 0) {
          const updated = buildDefaultDays();
          for (const w of windows) {
            if (w.dayOfWeek >= 0 && w.dayOfWeek <= 6) {
              updated[w.dayOfWeek] = {
                enabled: true,
                startTime: w.startTime,
                endTime: w.endTime,
              };
              if (w.timezone) setTimezone(w.timezone);
            }
          }
          // Disable days not in the windows list
          const enabledDays = new Set(windows.map((w) => w.dayOfWeek));
          for (let i = 0; i < 7; i++) {
            if (!enabledDays.has(i)) updated[i].enabled = false;
          }
          setDays(updated);
        }
      }
    } catch {
      setError('Network error loading calendar status');
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
      const res = await fetch('/api/oauth/calendar/authorize');
      if (!res.ok) {
        setFeedback({ type: 'error', message: 'Failed to initiate Calendar OAuth flow' });
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
      const res = await fetch('/api/pipeline/calendar', {
        method: 'DELETE',
      });
      if (!res.ok) {
        setFeedback({ type: 'error', message: 'Failed to disconnect calendar' });
        return;
      }
      setStatus({ connected: false });
      setDays(buildDefaultDays());
      setFeedback({ type: 'success', message: 'Calendar disconnected successfully.' });
    } catch {
      setFeedback({ type: 'error', message: 'Network error disconnecting calendar' });
    } finally {
      setDisconnecting(false);
    }
  }

  function updateDay(index: number, patch: Partial<DayConfig>) {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  async function handleSaveAvailability() {
    setSaving(true);
    setFeedback(null);
    try {
      const enabledDays = days.map((d, i) => ({ ...d, dayOfWeek: i })).filter((d) => d.enabled);

      const results = await Promise.all(
        enabledDays.map((d) =>
          fetch('/api/pipeline/calendar', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dayOfWeek: d.dayOfWeek,
              startTime: d.startTime,
              endTime: d.endTime,
              timezone,
            }),
          }),
        ),
      );

      const allOk = results.every((r) => r.ok);
      if (!allOk) {
        setFeedback({ type: 'error', message: 'Failed to save some availability windows' });
        return;
      }
      setFeedback({ type: 'success', message: 'Availability windows saved.' });
    } catch {
      setFeedback({ type: 'error', message: 'Network error saving availability' });
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
      <h2 className="text-2xl font-bold tracking-tight">Calendar Integration</h2>

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
            {status?.connected && status.calendarId && (
              <span className="text-sm text-muted-foreground">{status.calendarId}</span>
            )}
          </div>

          {!status?.connected ? (
            <Button onClick={handleConnect}>Connect Google Calendar</Button>
          ) : (
            <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Availability Window Config (only when connected) */}
      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle>Availability Windows</CardTitle>
            <p className="text-sm text-muted-foreground">
              Configure the days and times you are available for meetings.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="cal-timezone" className="text-sm font-medium">
                Timezone
              </label>
              <Input
                id="cal-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. America/New_York"
              />
            </div>

            <div className="space-y-2" role="list" aria-label="Day-of-week availability">
              {DAY_LABELS.map((label, i) => (
                <div
                  key={label}
                  className="flex items-center gap-3 rounded-lg border p-3"
                  role="listitem"
                >
                  <label className="flex items-center gap-2 min-w-[140px]">
                    <input
                      type="checkbox"
                      checked={days[i].enabled}
                      onChange={(e) => updateDay(i, { enabled: e.target.checked })}
                      aria-label={`Enable ${label}`}
                      className="h-4 w-4 rounded border-input"
                    />
                    <span className="text-sm font-medium">{label}</span>
                  </label>

                  {days[i].enabled && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={days[i].startTime}
                        onChange={(e) => updateDay(i, { startTime: e.target.value })}
                        aria-label={`${label} start time`}
                        className="w-32"
                      />
                      <span className="text-sm text-muted-foreground">–</span>
                      <Input
                        type="time"
                        value={days[i].endTime}
                        onChange={(e) => updateDay(i, { endTime: e.target.value })}
                        aria-label={`${label} end time`}
                        className="w-32"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Button onClick={handleSaveAvailability} disabled={saving}>
              {saving ? 'Saving...' : 'Save Availability'}
            </Button>
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
