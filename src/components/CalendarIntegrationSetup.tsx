'use client';

import { FOUNDER_ID } from '@/lib/constants';
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
    setLoading(true);
    setError(null);
    try {
      const [statusRes, windowsRes] = await Promise.all([
        fetch(`/api/pipeline/calendar/status?founderId=${FOUNDER_ID}`),
        fetch(`/api/pipeline/calendar?founderId=${FOUNDER_ID}`),
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
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function handleConnect() {
    setFeedback(null);
    try {
      const res = await fetch(`/api/oauth/calendar/authorize?founderId=${FOUNDER_ID}`);
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
      const res = await fetch(`/api/pipeline/calendar?founderId=${FOUNDER_ID}`, {
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

      // Save each enabled day as an availability window
      const results = await Promise.all(
        enabledDays.map((d) =>
          fetch('/api/pipeline/calendar', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              founderId: FOUNDER_ID,
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

  if (loading) {
    return (
      <div className="calendar-setup-loading" role="status" aria-live="polite">
        Loading calendar integration...
      </div>
    );
  }

  if (error) {
    return (
      <div className="calendar-setup-error" role="alert">
        <p>{error}</p>
        <button type="button" className="action-btn" onClick={fetchStatus}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="calendar-integration-setup">
      <h2>Calendar Integration</h2>

      {/* Connection Status */}
      <section aria-label="Calendar connection status">
        <div className="connection-status">
          <span
            className={`status-indicator ${status?.connected ? 'status-connected' : 'status-disconnected'}`}
          />
          <span className="status-text">
            {status?.connected ? `Connected — ${status.calendarId}` : 'Disconnected'}
          </span>
        </div>

        {!status?.connected ? (
          <button type="button" className="action-btn" onClick={handleConnect}>
            Connect Google Calendar
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

      {/* Availability Window Config (only when connected) */}
      {status?.connected && (
        <section aria-label="Availability windows">
          <h3>Availability Windows</h3>
          <p className="field-hint">Configure the days and times you are available for meetings.</p>

          <div className="form-field">
            <label htmlFor="cal-timezone">Timezone</label>
            <input
              id="cal-timezone"
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="e.g. America/New_York"
            />
          </div>

          <div className="availability-grid" role="list" aria-label="Day-of-week availability">
            {DAY_LABELS.map((label, i) => (
              <div key={label} className="availability-row" role="listitem">
                <label className="availability-day-toggle">
                  <input
                    type="checkbox"
                    checked={days[i].enabled}
                    onChange={(e) => updateDay(i, { enabled: e.target.checked })}
                    aria-label={`Enable ${label}`}
                  />
                  <span className="availability-day-label">{label}</span>
                </label>

                {days[i].enabled && (
                  <div className="availability-times">
                    <label>
                      <span className="sr-only">{label} start time</span>
                      <input
                        type="time"
                        value={days[i].startTime}
                        onChange={(e) => updateDay(i, { startTime: e.target.value })}
                        aria-label={`${label} start time`}
                      />
                    </label>
                    <span className="time-separator">–</span>
                    <label>
                      <span className="sr-only">{label} end time</span>
                      <input
                        type="time"
                        value={days[i].endTime}
                        onChange={(e) => updateDay(i, { endTime: e.target.value })}
                        aria-label={`${label} end time`}
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="action-btn"
            onClick={handleSaveAvailability}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Availability'}
          </button>
        </section>
      )}

      {feedback && (
        <div className={`form-feedback ${feedback.type}`} role="status">
          {feedback.message}
        </div>
      )}
    </div>
  );
}
