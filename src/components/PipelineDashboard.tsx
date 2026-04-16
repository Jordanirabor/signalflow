'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProject } from '@/contexts/ProjectContext';
import { useSession } from '@/hooks/useSession';
import type { PipelineMetrics, PipelineStatus } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 5000;

export default function PipelineDashboard() {
  const { session, isLoading: sessionLoading } = useSession();
  const { selectedProjectId } = useProject();
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; resolution?: string } | null>(
    null,
  );
  const [hasICP, setHasICP] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(
    async (isPolling = false) => {
      if (!session) return;
      if (!isPolling) setLoading(true);
      setError(null);
      try {
        const [metricsRes, statusRes, icpRes] = await Promise.all([
          fetch('/api/pipeline/metrics'),
          fetch('/api/pipeline/status'),
          !isPolling ? fetch('/api/icp/profiles') : Promise.resolve(null),
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

        // Check if ICP profiles exist
        if (icpRes && icpRes.ok) {
          const icpData = await icpRes.json();
          const profiles = icpData?.profiles ?? icpData ?? [];
          setHasICP(
            Array.isArray(profiles)
              ? profiles.some((p: { isActive?: boolean }) => p.isActive !== false)
              : false,
          );
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
    },
    [session],
  );

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
        body: JSON.stringify({}),
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
        body: JSON.stringify({}),
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
        body: JSON.stringify({ projectId: selectedProjectId }),
      }).catch(() => {
        // Errors will be picked up by polling
      });

      // Give the server a moment to create the pipeline_run record, then refresh
      await new Promise((r) => setTimeout(r, 1500));
      await fetchData();
    } finally {
      setActionLoading(null);
    }
  }, [fetchData, selectedProjectId]);

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

  function statusBadgeVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (state) {
      case 'running':
        return 'default';
      case 'paused':
        return 'secondary';
      case 'error':
        return 'destructive';
      default:
        return 'outline';
    }
  }

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-20" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-12" />
      </div>
    );
  }

  if (error && (!metrics || !status)) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => fetchData()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!metrics || !status) return null;

  const displayState = hasActiveRun
    ? 'Ingesting...'
    : status.state.charAt(0).toUpperCase() + status.state.slice(1);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Pipeline Dashboard</h2>

      {notification && (
        <Alert variant="destructive" role="alert" aria-label="Pipeline error notification">
          <AlertTitle>⚠️ Attention Required</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{notification.message}</p>
            {notification.resolution && (
              <p className="text-sm italic">Suggested resolution: {notification.resolution}</p>
            )}
            <Button variant="outline" size="sm" onClick={() => setNotification(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Status */}
      <Card aria-label="Pipeline status">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <Badge variant={hasActiveRun ? 'default' : statusBadgeVariant(status.state)}>
              {displayState}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Last run: {formatTimestamp(status.lastRun?.completedAt ?? status.lastRun?.startedAt)}
            </span>
            {!hasActiveRun && (
              <span className="text-sm text-muted-foreground">
                Next run: {formatTimestamp(status.nextRunAt)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Metrics */}
      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
        aria-label="Daily pipeline metrics"
      >
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Prospects Discovered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{metrics.prospectsDiscoveredToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Messages Sent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{metrics.messagesSentToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Replies Received
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{metrics.repliesReceivedToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Meetings Booked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{metrics.meetingsBookedToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reply Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{metrics.replyRatePercent.toFixed(1)}%</p>
          </CardContent>
        </Card>
      </section>

      {/* ICP Warning */}
      {hasICP === false && (
        <Alert>
          <AlertTitle>No ICP profiles defined</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              The pipeline needs at least one active ICP profile to discover leads. Define your
              ideal customer profiles first.
            </span>
            <Button variant="outline" size="sm" asChild>
              <a href="/icp">Go to ICP</a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Controls */}
      <Card aria-label="Pipeline controls">
        <CardHeader>
          <CardTitle>Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {status.state === 'running' && !hasActiveRun && (
              <Button variant="outline" onClick={handlePause} disabled={actionLoading !== null}>
                {actionLoading === 'pause' ? 'Pausing...' : 'Pause Pipeline'}
              </Button>
            )}
            {(status.state === 'paused' || status.state === 'error') && !hasActiveRun && (
              <Button variant="default" onClick={handleResume} disabled={actionLoading !== null}>
                {actionLoading === 'resume' ? 'Resuming...' : 'Resume Pipeline'}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleManualRun}
              disabled={
                actionLoading !== null || hasActiveRun || hasICP === false || !selectedProjectId
              }
            >
              {hasActiveRun
                ? 'Pipeline Running...'
                : actionLoading === 'run'
                  ? 'Starting...'
                  : 'Run Now'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
