'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
import type { ApiError, ThrottleConfig, ThrottleStatus } from '@/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

const MIN_LIMIT = 5;
const MAX_LIMIT = 50;

interface ThrottleStatusMap {
  email: ThrottleStatus;
  dm: ThrottleStatus;
}

export default function ThrottleConfigUI() {
  const { session, isLoading: sessionLoading } = useSession();
  // Config form state
  const [emailLimit, setEmailLimit] = useState('20');
  const [dmLimit, setDmLimit] = useState('20');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [dmError, setDmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  // Throttle status
  const [status, setStatus] = useState<ThrottleStatusMap | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!session) return;
    setConfigLoading(true);
    try {
      const res = await fetch('/api/throttle/config');
      if (res.ok) {
        const config: ThrottleConfig = await res.json();
        setEmailLimit(String(config.emailLimit));
        setDmLimit(String(config.dmLimit));
      }
    } catch {
      /* silent */
    } finally {
      setConfigLoading(false);
    }
  }, [session]);

  const fetchStatus = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/throttle/status');
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      /* silent */
    }
  }, [session]);

  useEffect(() => {
    fetchConfig();
    fetchStatus();
  }, [fetchConfig, fetchStatus]);

  function validateLimit(value: string, field: string): string | null {
    const num = parseInt(value, 10);
    if (isNaN(num) || !Number.isInteger(num)) {
      return `${field} must be a whole number`;
    }
    if (num < MIN_LIMIT || num > MAX_LIMIT) {
      return `${field} must be between ${MIN_LIMIT} and ${MAX_LIMIT}`;
    }
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormFeedback(null);

    const eErr = validateLimit(emailLimit, 'Email limit');
    const dErr = validateLimit(dmLimit, 'DM limit');
    setEmailError(eErr);
    setDmError(dErr);
    if (eErr || dErr) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/throttle/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailLimit: parseInt(emailLimit, 10),
          dmLimit: parseInt(dmLimit, 10),
        }),
      });

      if (!res.ok) {
        const err: ApiError = await res.json();
        if (err.details) {
          if (err.details.emailLimit) setEmailError(err.details.emailLimit);
          if (err.details.dmLimit) setDmError(err.details.dmLimit);
        }
        setFormFeedback({ type: 'error', message: err.message });
        return;
      }

      setFormFeedback({ type: 'success', message: 'Throttle limits updated successfully.' });
      await fetchStatus();
    } catch {
      setFormFeedback({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  function usagePercent(s: ThrottleStatus): number {
    if (s.limit === 0) return 0;
    return Math.min(100, Math.round((s.used / s.limit) * 100));
  }

  function barColor(s: ThrottleStatus): string {
    if (s.remaining === 0) return 'bg-destructive';
    if (s.warningThreshold) return 'bg-yellow-500';
    return 'bg-green-500';
  }

  if (sessionLoading || configLoading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Throttle Configuration</h2>

      {/* Current Status with Usage Bars */}
      {status && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Current throttle usage">
          {(['email', 'dm'] as const).map((channel) => {
            const s = status[channel];
            const pct = usagePercent(s);
            return (
              <Card key={channel}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    {channel === 'email' ? '📧 Email' : '💬 DM'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-secondary"
                    role="progressbar"
                    aria-valuenow={s.used}
                    aria-valuemin={0}
                    aria-valuemax={s.limit}
                    aria-label={`${channel} usage: ${s.used} of ${s.limit}`}
                  >
                    <div
                      className={`h-full rounded-full transition-all ${barColor(s)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {s.used} / {s.limit} used · {s.remaining} remaining
                    {s.warningThreshold && s.remaining > 0 && (
                      <span className="ml-1 text-yellow-600"> ⚠️ Approaching limit</span>
                    )}
                    {s.remaining === 0 && (
                      <span className="ml-1 text-destructive"> 🚫 Limit reached</span>
                    )}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Config Form */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Limits</CardTitle>
          <p className="text-sm text-muted-foreground">
            Set the maximum number of outreach actions per channel per day ({MIN_LIMIT}–{MAX_LIMIT}
            ).
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <label htmlFor="throttle-email-limit" className="text-sm font-medium">
                Email Limit <span aria-hidden="true">*</span>
              </label>
              <Input
                id="throttle-email-limit"
                type="number"
                min={MIN_LIMIT}
                max={MAX_LIMIT}
                value={emailLimit}
                onChange={(e) => {
                  setEmailLimit(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                aria-required="true"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'throttle-email-error' : undefined}
              />
              {emailError && (
                <p id="throttle-email-error" className="text-sm text-destructive" role="alert">
                  {emailError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="throttle-dm-limit" className="text-sm font-medium">
                DM Limit <span aria-hidden="true">*</span>
              </label>
              <Input
                id="throttle-dm-limit"
                type="number"
                min={MIN_LIMIT}
                max={MAX_LIMIT}
                value={dmLimit}
                onChange={(e) => {
                  setDmLimit(e.target.value);
                  if (dmError) setDmError(null);
                }}
                aria-required="true"
                aria-invalid={!!dmError}
                aria-describedby={dmError ? 'throttle-dm-error' : undefined}
              />
              {dmError && (
                <p id="throttle-dm-error" className="text-sm text-destructive" role="alert">
                  {dmError}
                </p>
              )}
            </div>

            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Limits'}
            </Button>

            {formFeedback && (
              <Alert
                variant={formFeedback.type === 'error' ? 'destructive' : 'default'}
                role="status"
              >
                <AlertTitle>{formFeedback.type === 'error' ? 'Error' : 'Success'}</AlertTitle>
                <AlertDescription>{formFeedback.message}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
