'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
import type { CRMStatus, Lead, UpcomingMeeting, WeeklySummary } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';

const CRM_STATUSES: CRMStatus[] = ['New', 'Contacted', 'Replied', 'Booked', 'Closed'];

export default function DashboardSummary() {
  const { session, isLoading: sessionLoading } = useSession();
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadStart = useRef<number>(0);

  const fetchSummary = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    loadStart.current = performance.now();
    try {
      const res = await fetch('/api/dashboard/summary');
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to load dashboard');
        return;
      }
      const data: WeeklySummary = await res.json();
      setSummary(data);

      // PostHog analytics tracking (Req 8.3)
      try {
        const posthog = await import('posthog-js');
        if (posthog.default) {
          const loadTime = performance.now() - loadStart.current;
          posthog.default.capture('dashboard_loaded', {
            load_time_ms: Math.round(loadTime),
            leads_contacted: data.leadsContacted,
            meetings_booked: data.meetingsBooked,
          });
        }
      } catch {
        /* PostHog unavailable — silent */
      }
    } catch {
      setError('Network error loading dashboard');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  function formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  function formatMeetingDate(meeting: UpcomingMeeting): string {
    const d = new Date(meeting.date);
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-32" />
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
          <Button variant="outline" size="sm" onClick={fetchSummary}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Weekly Dashboard</h2>

      {/* Weekly Metrics */}
      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Weekly metrics"
      >
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Leads Contacted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.leadsContacted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reply Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPercent(summary.replyRate)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Meetings Booked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.meetingsBooked}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Conversion Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPercent(summary.conversionRate)}</p>
          </CardContent>
        </Card>
      </section>

      {/* CRM Status Counts */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
            aria-label="CRM status counts"
          >
            {CRM_STATUSES.map((status) => (
              <div key={status} className="flex flex-col items-center gap-1 rounded-lg border p-3">
                <span className="text-2xl font-bold">{summary.statusCounts[status] ?? 0}</span>
                <Badge variant={status === 'Closed' ? 'default' : 'secondary'}>{status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Low Meeting Prompt */}
      {summary.lowMeetingPrompt && summary.lowMeetingPrompt.length > 0 && (
        <Alert role="alert">
          <AlertTitle>You have fewer than 3 meetings this week</AlertTitle>
          <AlertDescription>
            <p className="mb-2">Consider reaching out to these high-scoring leads:</p>
            <ul className="space-y-2">
              {summary.lowMeetingPrompt.map((lead: Lead) => (
                <li key={lead.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{lead.name}</span>
                  <span className="text-muted-foreground">{lead.company}</span>
                  <Badge variant="outline">Score: {lead.leadScore}</Badge>
                  <Badge variant="secondary">{lead.crmStatus}</Badge>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Upcoming Meetings */}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Meetings</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.upcomingMeetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming meetings scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {summary.upcomingMeetings.map((meeting: UpcomingMeeting, i: number) => (
                <li key={i} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <span className="font-medium">{meeting.leadName}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatMeetingDate(meeting)}
                  </span>
                  <span className="text-sm text-muted-foreground">{meeting.time}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* High-Priority Suggestions */}
      <Card>
        <CardHeader>
          <CardTitle>High-Priority Leads</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.highPrioritySuggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No high-priority leads to suggest right now.
            </p>
          ) : (
            <ul className="space-y-2">
              {summary.highPrioritySuggestions.map((lead: Lead) => (
                <li
                  key={lead.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                >
                  <span className="font-medium">{lead.name}</span>
                  <span className="text-muted-foreground">{lead.company}</span>
                  <span className="text-sm text-muted-foreground">{lead.role}</span>
                  <Badge variant="outline">Score: {lead.leadScore}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
