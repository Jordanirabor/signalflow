'use client';

import ComposeEmailModal from '@/components/ComposeEmailModal';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/useSession';
import type { ApiError, CRMStatus, OutreachRecord, ThrottleStatus } from '@/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

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

interface OutreachTrackerProps {
  leadId: string;
  prefillMessage?: string;
  lead?: { id: string; name: string; email?: string; crmStatus: CRMStatus };
}

export default function OutreachTracker({ leadId, prefillMessage, lead }: OutreachTrackerProps) {
  const { session, isLoading: sessionLoading } = useSession();
  // Form state
  const [channel, setChannel] = useState<'email' | 'dm'>('email');
  const [messageContent, setMessageContent] = useState(prefillMessage ?? '');
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  // Throttle state
  const [throttle, setThrottle] = useState<ThrottleStatusMap | null>(null);

  // Outreach history
  const [history, setHistory] = useState<OutreachRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Stale leads
  const [showStale, setShowStale] = useState(false);
  const [staleLeads, setStaleLeads] = useState<StaleLeadEntry[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);

  // Sync prefillMessage prop changes
  useEffect(() => {
    if (prefillMessage !== undefined) {
      setMessageContent(prefillMessage);
    }
  }, [prefillMessage]);

  const fetchThrottleStatus = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/throttle/status');
      if (res.ok) {
        const data: ThrottleStatusMap = await res.json();
        setThrottle(data);
      }
    } catch {
      /* silent */
    }
  }, [session]);

  const fetchHistory = useCallback(async () => {
    if (!session) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/outreach/${leadId}`);
      if (res.ok) {
        const data: OutreachRecord[] = await res.json();
        setHistory(data);
      }
    } catch {
      /* silent */
    } finally {
      setHistoryLoading(false);
    }
  }, [leadId, session]);

  useEffect(() => {
    fetchThrottleStatus();
    fetchHistory();
  }, [fetchThrottleStatus, fetchHistory]);

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

  const currentThrottle = throttle ? throttle[channel] : null;
  const isBlocked = currentThrottle ? currentThrottle.remaining === 0 : false;
  const isWarning = currentThrottle ? currentThrottle.warningThreshold : false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!messageContent.trim()) {
      setFormError('Message content is required');
      return;
    }

    if (isBlocked) {
      setFormError(`Daily ${channel} outreach limit reached. Try again tomorrow.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          channel,
          messageContent: messageContent.trim(),
          isFollowUp,
        }),
      });

      if (res.status === 429) {
        const err: ApiError = await res.json();
        setFormError(err.message);
        await fetchThrottleStatus();
        return;
      }

      if (!res.ok) {
        const err: ApiError = await res.json();
        setFormError(err.message);
        return;
      }

      setFormSuccess('Outreach recorded successfully');
      setMessageContent('');
      setIsFollowUp(false);
      await Promise.all([fetchHistory(), fetchThrottleStatus()]);
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function daysSince(dateStr: string): number {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  if (sessionLoading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold tracking-tight">Send Outreach</h3>

      {/* Throttle warning banner */}
      {isWarning && !isBlocked && currentThrottle && (
        <Alert role="status">
          <AlertTitle>⚠️ Approaching Limit</AlertTitle>
          <AlertDescription>
            You have used {currentThrottle.used} of {currentThrottle.limit} daily {channel} outreach
            actions. {currentThrottle.remaining} remaining.
          </AlertDescription>
        </Alert>
      )}

      {/* Throttle blocked banner */}
      {isBlocked && currentThrottle && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Limit Reached</AlertTitle>
          <AlertDescription>
            Daily {channel} outreach limit reached ({currentThrottle.limit}). Try again tomorrow.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Channel</legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="outreach-channel"
                    value="email"
                    checked={channel === 'email'}
                    onChange={() => setChannel('email')}
                    className="h-4 w-4"
                  />
                  Email
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="outreach-channel"
                    value="dm"
                    checked={channel === 'dm'}
                    onChange={() => setChannel('dm')}
                    className="h-4 w-4"
                  />
                  DM
                </label>
              </div>
            </fieldset>

            <div className="space-y-2">
              <label htmlFor="outreach-message" className="text-sm font-medium">
                Message Content <span aria-hidden="true">*</span>
              </label>
              <Textarea
                id="outreach-message"
                value={messageContent}
                onChange={(e) => {
                  setMessageContent(e.target.value);
                  if (formError === 'Message content is required') setFormError(null);
                }}
                placeholder="Enter your outreach message..."
                rows={6}
                aria-required="true"
                aria-invalid={formError === 'Message content is required'}
                aria-describedby={
                  formError === 'Message content is required' ? 'outreach-message-error' : undefined
                }
              />
              {formError === 'Message content is required' && (
                <p id="outreach-message-error" className="text-sm text-destructive" role="alert">
                  {formError}
                </p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isFollowUp}
                onChange={(e) => setIsFollowUp(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              This is a follow-up
            </label>

            {channel === 'email' ? (
              <Button type="button" onClick={() => setComposeOpen(true)} disabled={isBlocked}>
                Compose Email
              </Button>
            ) : (
              <Button type="submit" disabled={submitting || isBlocked} aria-disabled={isBlocked}>
                {submitting ? 'Sending...' : 'Send Email'}
              </Button>
            )}

            {formError && formError !== 'Message content is required' && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {formSuccess && (
              <Alert role="status">
                <AlertDescription>{formSuccess}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Outreach History */}
      <Card>
        <CardHeader>
          <CardTitle>Outreach History</CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-2">
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
                  <TableHead>Channel</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(o.outreachDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={o.channel === 'email' ? 'default' : 'secondary'}>
                        {o.channel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {o.isFollowUp && <Badge variant="outline">Follow-up</Badge>}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">{o.messageContent}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Stale Leads */}
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

      {lead && (
        <ComposeEmailModal
          open={composeOpen}
          onOpenChange={setComposeOpen}
          lead={lead}
          prefillBody={messageContent}
          onSuccess={() => {
            setMessageContent('');
            Promise.all([fetchHistory(), fetchThrottleStatus()]);
          }}
        />
      )}
    </div>
  );
}
