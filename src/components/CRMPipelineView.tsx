'use client';

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

function statusBadgeVariant(
  status: CRMStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'Booked':
    case 'Closed':
      return 'default';
    case 'Replied':
      return 'secondary';
    case 'Contacted':
      return 'outline';
    default:
      return 'outline';
  }
}

export default function CRMPipelineView() {
  const { session, isLoading: sessionLoading } = useSession();
  const [pipeline, setPipeline] = useState<PipelineView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');

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

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
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

  const filteredLeads =
    activeTab === 'all' ? pipeline.leads : pipeline.leads.filter((l) => l.crmStatus === activeTab);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">CRM Pipeline</h2>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Status Counts */}
      <section
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
        aria-label="Pipeline status counts"
      >
        {CRM_STATUSES.map((status) => (
          <Card key={status}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{status}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{pipeline.counts[status] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Leads Table with Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {CRM_STATUSES.map((status) => (
            <TabsTrigger key={status} value={status}>
              {status}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {filteredLeads.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-muted-foreground">
                  {activeTab === 'all'
                    ? 'No leads in the pipeline yet. Discover your first leads to get started.'
                    : `No leads with status "${activeTab}".`}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Activity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLeads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium">{lead.name}</TableCell>
                        <TableCell>{lead.company}</TableCell>
                        <TableCell className="text-muted-foreground">{lead.role}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{lead.leadScore}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(lead.crmStatus)}>
                            {lead.crmStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(lead.updatedAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
