'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSession } from '@/hooks/useSession';
import type { ThrottleStatus } from '@/types';
import { useCallback, useEffect, useState } from 'react';

// --- Types for API responses ---

interface OutreachSummary {
  totalSent: number;
  replyCount: number;
  replyRate: number;
}

interface OutreachHistoryEntry {
  id: string;
  leadId: string;
  leadName: string;
  leadCompany: string;
  channel: 'email' | 'dm';
  messageContent: string;
  outreachDate: string;
  isFollowUp: boolean;
}

interface StaleLeadEntry {
  leadId: string;
  leadName: string;
  company: string;
  crmStatus: string;
  lastOutreachDate: string;
}

interface ThrottleStatusMap {
  email: ThrottleStatus;
  dm: ThrottleStatus;
}

export default function OutreachPage() {
  const { session, isLoading: sessionLoading } = useSession();

  // Summary stats
  const [summary, setSummary] = useState<OutreachSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Outreach history
  const [history, setHistory] = useState<OutreachHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Stale leads
  const [showStale, setShowStale] = useState(false);
  const [staleLeads, setStaleLeads] = useState<StaleLeadEntry[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);

  // Throttle status
  const [throttle, setThrottle] = useState<ThrottleStatusMap | null>(null);
  const [throttleLoading, setThrottleLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    if (!session) return;
    setSummaryLoading(true);
    try {
      const res = await fetch('/api/outreach/summary');
      if (res.ok) {
        const data: OutreachSummary = await res.json();
        setSummary(data);
      }
    } catch {
      /* silent */
    } finally {
      setSummaryLoading(false);
    }
  }, [session]);

  const fetchHistory = useCallback(async () => {
    if (!session) return;
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/outreach/history');
      if (res.ok) {
        const data: OutreachHistoryEntry[] = await res.json();
        setHistory(data);
      }
    } catch {
      /* silent */
    } finally {
      setHistoryLoading(false);
    }
  }, [session]);

  const fetchThrottle = useCallback(async () => {
    if (!session) return;
    setThrottleLoading(true);
    try {
      const res = await fetch('/api/throttle/status');
      if (res.ok) {
        const data: ThrottleStatusMap = await res.json();
        setThrottle(data);
      }
    } catch {
      /* silent */
    } finally {
      setThrottleLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchSummary();
    fetchHistory();
    fetchThrottle();
  }, [fetchSummary, fetchHistory, fetchThrottle]);

  async function fetchStaleLeads() {
    setStaleLoading(true);
    try {
      const res = await fetch('/api/outreach/stale');
      if (res.ok) {
        const data: StaleLeadEntry[] = await res.json();
        setStaleLeads(data);
      }
    } catch {
      /* silent */
    } finally {
      setStaleLoading(false);
    }
  }

  function handleToggleStale() {
    const next = !showStale;
    setShowStale(next);
    if (next) fetchStaleLeads();
  }

  function daysSince(dateStr: string): number {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  if (sessionLoading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Outreach Tracking</h1>
        <p className="text-muted-foreground">Monitor sent messages, replies, and stale leads</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Sent</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold">{summary?.totalSent ?? 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Replies</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold">{summary?.replyCount ?? 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reply Rate</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-bold">{(summary?.replyRate ?? 0).toFixed(1)}%</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Outreach History Table */}
      <Card>
        <CardHeader>
          <CardTitle>Outreach History</CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No outreach recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(entry.outreachDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{entry.leadName}</div>
                      <div className="text-muted-foreground text-xs">{entry.leadCompany}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.channel === 'email' ? 'default' : 'secondary'}>
                        {entry.channel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.isFollowUp ? (
                        <Badge variant="outline">Follow-up</Badge>
                      ) : (
                        <Badge variant="outline">Initial</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">
                      {entry.messageContent}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Stale Leads Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Stale Leads</CardTitle>
          <Button variant="outline" size="sm" onClick={handleToggleStale}>
            {showStale ? 'Hide' : 'Show'} Stale Leads
          </Button>
        </CardHeader>
        {showStale && (
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Stale leads are prospects you contacted over 7 days ago who haven&apos;t replied.
              Consider re-engaging them with a fresh approach.
            </p>
            {staleLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : staleLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stale leads found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Contact Date</TableHead>
                    <TableHead>Days Since Outreach</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staleLeads.map((staleLead) => (
                    <TableRow key={staleLead.leadId}>
                      <TableCell className="font-medium">{staleLead.leadName}</TableCell>
                      <TableCell>{staleLead.company}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{staleLead.crmStatus}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(staleLead.lastOutreachDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{daysSince(staleLead.lastOutreachDate)} days</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        )}
      </Card>

      {/* Throttle Status */}
      <Card>
        <CardHeader>
          <CardTitle>Throttle Status</CardTitle>
        </CardHeader>
        <CardContent>
          {throttleLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-6 w-48" />
            </div>
          ) : throttle ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Email</span>
                  <span className="text-sm text-muted-foreground">
                    {throttle.email.used} / {throttle.email.limit}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full ${
                      throttle.email.warningThreshold ? 'bg-orange-500' : 'bg-primary'
                    }`}
                    style={{
                      width: `${Math.min((throttle.email.used / throttle.email.limit) * 100, 100)}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {throttle.email.remaining} remaining
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">DM</span>
                  <span className="text-sm text-muted-foreground">
                    {throttle.dm.used} / {throttle.dm.limit}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full ${
                      throttle.dm.warningThreshold ? 'bg-orange-500' : 'bg-primary'
                    }`}
                    style={{
                      width: `${Math.min((throttle.dm.used / throttle.dm.limit) * 100, 100)}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{throttle.dm.remaining} remaining</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Unable to load throttle status.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
