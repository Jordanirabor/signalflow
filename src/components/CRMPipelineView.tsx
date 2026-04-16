'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
import type { CRMStatus } from '@/types';
import { useCallback, useEffect, useState } from 'react';

interface PipelineLead {
  id: string;
  name: string;
  role: string;
  company: string;
  leadScore: number;
  crmStatus: CRMStatus;
  updatedAt: Date;
}

interface PipelineView {
  counts: Record<CRMStatus, number>;
  leads: PipelineLead[];
}

const CRM_STATUSES: CRMStatus[] = ['New', 'Contacted', 'Replied', 'Booked', 'Closed'];

const STATUS_COLORS: Record<CRMStatus, string> = {
  New: 'border-l-blue-400',
  Contacted: 'border-l-amber-400',
  Replied: 'border-l-emerald-400',
  Booked: 'border-l-violet-400',
  Closed: 'border-l-zinc-400',
};

export default function CRMPipelineView() {
  const { session, isLoading: sessionLoading } = useSession();
  const [pipeline, setPipeline] = useState<PipelineView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);

  const fetchPipeline = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/crm/pipeline');
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to load pipeline');
        return;
      }
      const data: PipelineView = await res.json();
      setPipeline(data);
    } catch {
      setError('Network error loading pipeline');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  async function moveToStatus(leadId: string, toStatus: CRMStatus) {
    setMovingLeadId(leadId);
    try {
      const res = await fetch(`/api/crm/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStatus }),
      });
      if (res.ok) {
        // Optimistic update
        setPipeline((prev) => {
          if (!prev) return prev;
          const lead = prev.leads.find((l) => l.id === leadId);
          if (!lead) return prev;
          const oldStatus = lead.crmStatus;
          const newCounts = { ...prev.counts };
          newCounts[oldStatus] = Math.max(0, (newCounts[oldStatus] ?? 0) - 1);
          newCounts[toStatus] = (newCounts[toStatus] ?? 0) + 1;
          return {
            counts: newCounts,
            leads: prev.leads.map((l) =>
              l.id === leadId ? { ...l, crmStatus: toStatus, updatedAt: new Date() } : l,
            ),
          };
        });
      }
    } catch {
      /* silent */
    } finally {
      setMovingLeadId(null);
    }
  }

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-8" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !pipeline) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={fetchPipeline}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!pipeline) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">CRM Pipeline</h2>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Kanban Board */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {CRM_STATUSES.map((status) => {
          const leads = pipeline.leads.filter((l) => l.crmStatus === status);
          const nextStatus = CRM_STATUSES[CRM_STATUSES.indexOf(status) + 1] as
            | CRMStatus
            | undefined;

          return (
            <div key={status} className="flex flex-col">
              {/* Column header */}
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{status}</h3>
                <Badge variant="secondary" className="text-xs">
                  {pipeline.counts[status] ?? 0}
                </Badge>
              </div>
              <Separator className="mb-3" />

              {/* Cards */}
              <div className="flex flex-1 flex-col gap-2">
                {leads.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No leads
                  </div>
                ) : (
                  leads.map((lead) => (
                    <Card key={lead.id} className={`border-l-4 ${STATUS_COLORS[status]}`}>
                      <CardContent className="p-3">
                        <div className="font-medium text-sm">{lead.name}</div>
                        {lead.company && (
                          <div className="text-xs text-muted-foreground">{lead.company}</div>
                        )}
                        <div className="text-xs text-muted-foreground">{lead.role}</div>
                        <div className="mt-2 flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">
                            {lead.leadScore}
                          </Badge>
                          {nextStatus && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              disabled={movingLeadId === lead.id}
                              onClick={() => moveToStatus(lead.id, nextStatus)}
                            >
                              {movingLeadId === lead.id ? '...' : `→ ${nextStatus}`}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
