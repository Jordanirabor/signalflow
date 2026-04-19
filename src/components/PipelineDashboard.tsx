'use client';

import { RunScopeSelector, type RunScopeSelection } from '@/components/RunScopeSelector';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
import { formatICPProfileLabel } from '@/lib/icpProfileLabel';
import type { ICPProfile, ICPProject, PipelineMetrics, PipelineRun, PipelineStatus } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 5000;

export default function PipelineDashboard() {
  const { session, isLoading: sessionLoading } = useSession();
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; resolution?: string } | null>(
    null,
  );
  const [hasICP, setHasICP] = useState<boolean | null>(null);
  const [runScope, setRunScope] = useState<RunScopeSelection>({ scope: 'all' });
  const [runHistory, setRunHistory] = useState<PipelineRun[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, ICPProfile>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(
    async (isPolling = false) => {
      if (!session) return;
      if (!isPolling) setLoading(true);
      setError(null);
      try {
        let metricsUrl = '/api/pipeline/metrics';
        if (runScope.scope === 'profile' && runScope.icpProfileId) {
          metricsUrl = `/api/pipeline/metrics?icpProfileId=${runScope.icpProfileId}`;
        }

        const [metricsRes, statusRes, icpRes, runsRes] = await Promise.all([
          fetch(metricsUrl),
          fetch('/api/pipeline/status'),
          !isPolling ? fetch('/api/icp/profiles') : Promise.resolve(null),
          !isPolling ? fetch('/api/pipeline/runs?limit=10') : Promise.resolve(null),
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

        // Check if ICP profiles exist and build profiles map
        if (icpRes && icpRes.ok) {
          const icpData = await icpRes.json();
          const profiles = icpData?.profiles ?? icpData ?? [];
          setHasICP(
            Array.isArray(profiles)
              ? profiles.some((p: { isActive?: boolean }) => p.isActive !== false)
              : false,
          );
          // Build a map of profile id -> profile for label display
          if (Array.isArray(profiles)) {
            const map: Record<string, ICPProfile> = {};
            for (const p of profiles) {
              if (p.id) map[p.id] = p;
            }
            setProfilesMap(map);
          }
        }

        // Parse run history
        if (runsRes && runsRes.ok) {
          const runsData: PipelineRun[] = await runsRes.json();
          setRunHistory(Array.isArray(runsData) ? runsData : []);
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
    [session, runScope],
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
      const fireRun = (body: Record<string, string>) => {
        fetch('/api/pipeline/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {
          // Errors will be picked up by polling
        });
      };

      if (runScope.scope === 'all') {
        // Fetch active projects and fire a run for each
        try {
          const res = await fetch('/api/projects');
          if (res.ok) {
            const projects: ICPProject[] = await res.json();
            const active = projects.filter((p) => !p.isDeleted && p.isActive);
            for (const project of active) {
              fireRun({ projectId: project.id });
            }
          }
        } catch {
          // Errors will be picked up by polling
        }
      } else if (runScope.scope === 'project' && runScope.projectId) {
        fireRun({ projectId: runScope.projectId });
      } else if (runScope.scope === 'profile' && runScope.projectId && runScope.icpProfileId) {
        fireRun({ projectId: runScope.projectId, icpProfileId: runScope.icpProfileId });
      }

      // Give the server a moment to create the pipeline_run record, then refresh
      await new Promise((r) => setTimeout(r, 1500));
      await fetchData();
    } finally {
      setActionLoading(null);
    }
  }, [fetchData, runScope]);

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

  function getRunProfileLabel(run?: PipelineRun): string {
    if (!run?.icpProfileId) return 'All Profiles';
    const profile = profilesMap[run.icpProfileId];
    if (profile) return formatICPProfileLabel(profile);
    return 'All Profiles';
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
            {status.lastRun && (
              <span className="text-sm text-muted-foreground">
                Profile: {getRunProfileLabel(status.lastRun)}
              </span>
            )}
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
            <RunScopeSelector
              founderId={session!.founderId}
              value={runScope}
              onChange={setRunScope}
              disabled={actionLoading !== null || hasActiveRun}
            />
            <Button
              variant="secondary"
              onClick={handleManualRun}
              disabled={actionLoading !== null || hasActiveRun || hasICP === false}
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

      {/* Run History */}
      {runHistory.length > 0 && (
        <Card aria-label="Pipeline run history">
          <CardHeader>
            <CardTitle>Run History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {runHistory
                .filter((run) => {
                  if (runScope.scope === 'profile' && runScope.icpProfileId) {
                    return run.icpProfileId === runScope.icpProfileId;
                  }
                  if (runScope.scope === 'project' && runScope.projectId) {
                    return run.projectId === runScope.projectId;
                  }
                  return true;
                })
                .map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center gap-3 rounded border p-2 text-sm"
                  >
                    <Badge variant={statusBadgeVariant(run.status)}>
                      {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                    </Badge>
                    <span className="text-muted-foreground">
                      {formatTimestamp(run.completedAt ?? run.startedAt)}
                    </span>
                    <span className="text-muted-foreground">
                      Profile: {getRunProfileLabel(run)}
                    </span>
                    <span className="text-muted-foreground">
                      {run.prospectsDiscovered} discovered · {run.messagesSent} sent ·{' '}
                      {run.repliesProcessed} replies · {run.meetingsBooked} meetings
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
