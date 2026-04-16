'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { PipelineMetrics, PipelineStatus } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 5000;

export default function PipelineDashboard() {
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; resolution?: string } | null>(
    null,
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    setError(null);
    try {
      const [metricsRes, statusRes] = await Promise.all([
        fetch(`/api/pipeline/metrics?founderId=${FOUNDER_ID}`),
        fetch(`/api/pipeline/status?founderId=${FOUNDER_ID}`),
      ]);

      if (!metricsRes.ok) {
        const err = await metricsRes.json();
        setError(err.message ?? 'Failed to load pipeline metrics');
        return;
      }
      if (!statusRes.ok) {
        const err = await statusRes.json();
        setError(err.message ?? 'Failed to load pipeline status');
        return;
      }

      const metricsData: PipelineMetrics = await metricsRes.json();
      const statusData: PipelineStatus = await statusRes.json();

      setMetrics(metricsData);
      setStatus(statusData);

      if (statusData.state === 'error' && statusData.lastRun?.stageErrors) {
        const errors = statusData.lastRun.stageErrors;
        const errorKeys = Object.keys(errors);
        if (errorKeys.length > 0) {
          setNotification({
            message: `Pipeline error in stage: ${errorKeys.join(', ')}. ${errors[errorKeys[0]]}`,
            resolution:
              'Check your email/calendar connections and pipeline configuration, then resume the pipeline.',
          });
        }
      } else {
        setNotification(null);
      }
    } catch {
      if (!isPolling) setError('Network error loading pipeline data');
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, []);

  // Poll while there's an active run (server-driven)
  const hasActiveRun = status?.hasActiveRun ?? false;

  useEffect(() => {
    if (hasActiveRun) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => fetchData(true), POLL_INTERVAL_MS);
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [hasActiveRun, fetchData]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePause = useCallback(async () => {
    setActionLoading('pause');
    try {
      const res = await fetch('/api/pipeline/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ founderId: FOUNDER_ID }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to pause pipeline');
        return;
      }
      await fetchData();
    } catch {
      setError('Network error pausing pipeline');
    } finally {
      setActionLoading(null);
    }
  }, [fetchData]);

  const handleResume = useCallback(async () => {
    setActionLoading('resume');
    try {
      const res = await fetch('/api/pipeline/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ founderId: FOUNDER_ID }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to resume pipeline');
        return;
      }
      await fetchData();
    } catch {
      setError('Network error resuming pipeline');
    } finally {
      setActionLoading(null);
    }
  }, [fetchData]);

  const handleManualRun = useCallback(async () => {
    setActionLoading('run');
    try {
      // Fire-and-forget: don't await the full pipeline run
      fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ founderId: FOUNDER_ID }),
      }).catch(() => {
        // Errors will be picked up by polling
      });

      // Give the server a moment to create the pipeline_run record, then refresh
      await new Promise((r) => setTimeout(r, 1500));
      await fetchData();
    } finally {
      setActionLoading(null);
    }
  }, [fetchData]);

  function formatTimestamp(date?: Date | string): string {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function statusBadgeClass(state: string): string {
    switch (state) {
      case 'running':
        return 'status-badge-running';
      case 'paused':
        return 'status-badge-paused';
      case 'error':
        return 'status-badge-error';
      default:
        return '';
    }
  }

  if (loading) {
    return (
      <div className="dashboard-loading" role="status" aria-live="polite">
        Loading pipeline dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error" role="alert">
        <p>{error}</p>
        <button type="button" className="action-btn" onClick={() => fetchData()}>
          Retry
        </button>
      </div>
    );
  }

  if (!metrics || !status) return null;

  const displayState = hasActiveRun
    ? 'Ingesting...'
    : status.state.charAt(0).toUpperCase() + status.state.slice(1);

  return (
    <div className="pipeline-dashboard">
      <h2>Pipeline Dashboard</h2>

      {notification && (
        <section
          className="pipeline-notification"
          role="alert"
          aria-label="Pipeline error notification"
        >
          <div className="notification-error">
            <strong>⚠️ Attention Required</strong>
            <p>{notification.message}</p>
            {notification.resolution && (
              <p className="notification-resolution">
                <em>Suggested resolution:</em> {notification.resolution}
              </p>
            )}
            <button type="button" className="action-btn" onClick={() => setNotification(null)}>
              Dismiss
            </button>
          </div>
        </section>
      )}

      <section className="pipeline-status-section" aria-label="Pipeline status">
        <h3>Status</h3>
        <div className="pipeline-status-row">
          <span
            className={`pipeline-status-badge ${hasActiveRun ? 'status-badge-running' : statusBadgeClass(status.state)}`}
          >
            {displayState}
          </span>
          <span className="pipeline-status-detail">
            Last run: {formatTimestamp(status.lastRun?.completedAt ?? status.lastRun?.startedAt)}
          </span>
          {!hasActiveRun && (
            <span className="pipeline-status-detail">
              Next run: {formatTimestamp(status.nextRunAt)}
            </span>
          )}
        </div>
      </section>

      <section className="dashboard-metrics" aria-label="Daily pipeline metrics">
        <div className="metric-card">
          <span className="metric-value">{metrics.prospectsDiscoveredToday}</span>
          <span className="metric-label">Prospects Discovered</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{metrics.messagesSentToday}</span>
          <span className="metric-label">Messages Sent</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{metrics.repliesReceivedToday}</span>
          <span className="metric-label">Replies Received</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{metrics.meetingsBookedToday}</span>
          <span className="metric-label">Meetings Booked</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{metrics.replyRatePercent.toFixed(1)}%</span>
          <span className="metric-label">Reply Rate</span>
        </div>
      </section>

      <section className="pipeline-controls" aria-label="Pipeline controls">
        <h3>Controls</h3>
        <div className="pipeline-controls-row">
          {status.state === 'running' && !hasActiveRun && (
            <button
              type="button"
              className="action-btn action-btn-warning"
              onClick={handlePause}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'pause' ? 'Pausing...' : 'Pause Pipeline'}
            </button>
          )}
          {(status.state === 'paused' || status.state === 'error') && !hasActiveRun && (
            <button
              type="button"
              className="action-btn action-btn-success"
              onClick={handleResume}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'resume' ? 'Resuming...' : 'Resume Pipeline'}
            </button>
          )}
          <button
            type="button"
            className="action-btn"
            onClick={handleManualRun}
            disabled={actionLoading !== null || hasActiveRun}
          >
            {hasActiveRun
              ? 'Pipeline Running...'
              : actionLoading === 'run'
                ? 'Starting...'
                : 'Run Now'}
          </button>
        </div>
      </section>
    </div>
  );
}
