'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { ApiError, ThrottleConfig, ThrottleStatus } from '@/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
const MIN_LIMIT = 5;
const MAX_LIMIT = 50;

interface ThrottleStatusMap {
  email: ThrottleStatus;
  dm: ThrottleStatus;
}

export default function ThrottleConfigUI() {
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
    setConfigLoading(true);
    try {
      const res = await fetch(`/api/throttle/config?founderId=${FOUNDER_ID}`);
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
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/throttle/status?founderId=${FOUNDER_ID}`);
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      /* silent */
    }
  }, []);

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
          founderId: FOUNDER_ID,
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
    if (s.remaining === 0) return '#dc2626';
    if (s.warningThreshold) return '#d97706';
    return '#16a34a';
  }

  if (configLoading) {
    return <div className="throttle-loading">Loading throttle settings...</div>;
  }

  return (
    <div className="throttle-config">
      <h2>Throttle Configuration</h2>

      {/* Current Status with Usage Bars */}
      {status && (
        <section className="throttle-status-section" aria-label="Current throttle usage">
          <h3>Today&apos;s Usage</h3>
          <div className="throttle-status-grid">
            {(['email', 'dm'] as const).map((channel) => {
              const s = status[channel];
              const pct = usagePercent(s);
              return (
                <div key={channel} className="throttle-status-card">
                  <div className="throttle-channel-label">
                    {channel === 'email' ? '📧 Email' : '💬 DM'}
                  </div>
                  <div
                    className="throttle-usage-bar-container"
                    role="progressbar"
                    aria-valuenow={s.used}
                    aria-valuemin={0}
                    aria-valuemax={s.limit}
                    aria-label={`${channel} usage: ${s.used} of ${s.limit}`}
                  >
                    <div
                      className="throttle-usage-bar"
                      style={{ width: `${pct}%`, backgroundColor: barColor(s) }}
                    />
                  </div>
                  <div className="throttle-usage-text">
                    {s.used} / {s.limit} used · {s.remaining} remaining
                    {s.warningThreshold && s.remaining > 0 && (
                      <span className="throttle-warning-text"> ⚠️ Approaching limit</span>
                    )}
                    {s.remaining === 0 && (
                      <span className="throttle-blocked-text"> 🚫 Limit reached</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Config Form */}
      <form onSubmit={handleSubmit} className="throttle-form" noValidate>
        <h3>Daily Limits</h3>
        <p className="throttle-form-hint">
          Set the maximum number of outreach actions per channel per day ({MIN_LIMIT}–{MAX_LIMIT}).
        </p>

        <div className="form-field">
          <label htmlFor="throttle-email-limit">
            Email Limit <span aria-hidden="true">*</span>
          </label>
          <input
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
            <span id="throttle-email-error" className="field-error" role="alert">
              {emailError}
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="throttle-dm-limit">
            DM Limit <span aria-hidden="true">*</span>
          </label>
          <input
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
            <span id="throttle-dm-error" className="field-error" role="alert">
              {dmError}
            </span>
          )}
        </div>

        <button type="submit" className="action-btn" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save Limits'}
        </button>

        {formFeedback && (
          <div className={`form-feedback ${formFeedback.type}`} role="status">
            {formFeedback.message}
          </div>
        )}
      </form>
    </div>
  );
}
