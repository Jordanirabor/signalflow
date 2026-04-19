'use client';

import InsightForm from '@/components/InsightForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useProject } from '@/contexts/ProjectContext';
import { useSession } from '@/hooks/useSession';
import type { Lead } from '@/types';
import { useCallback, useEffect, useState } from 'react';

export default function InsightsPage() {
  const { session, isLoading: sessionLoading } = useSession();
  const { selectedProjectId } = useProject();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');

  const fetchLeads = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedProjectId) params.set('projectId', selectedProjectId);
      const query = params.toString();
      const res = await fetch(`/api/leads${query ? `?${query}` : ''}`);
      if (res.ok) {
        setLeads(await res.json());
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [session, selectedProjectId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Reset selection when project changes
  useEffect(() => {
    setSelectedLeadId('');
  }, [selectedProjectId]);

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Select a Lead</CardTitle>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leads found. Discover or add leads first.
            </p>
          ) : (
            <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
              <SelectTrigger className="w-full max-w-md" aria-label="Select a lead">
                <SelectValue placeholder="Choose a lead..." />
              </SelectTrigger>
              <SelectContent>
                {leads.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.name} — {lead.company} ({lead.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedLeadId && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setSelectedLeadId('')}
            >
              Clear selection
            </Button>
          )}
        </CardContent>
      </Card>

      {selectedLeadId && <InsightForm leadId={selectedLeadId} />}
    </div>
  );
}
