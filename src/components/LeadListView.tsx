'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import type { ApiError, Lead } from '@/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Toast {
  type: 'success' | 'error' | 'info';
  message: string;
  linkTo?: string;
  linkLabel?: string;
}

interface NewLeadForm {
  name: string;
  role: string;
  company: string;
  industry: string;
  geography: string;
}

const emptyForm: NewLeadForm = { name: '', role: '', company: '', industry: '', geography: '' };

export default function LeadListView({
  onSelectLead,
  projectId,
}: {
  onSelectLead?: (id: string) => void;
  projectId?: string | null;
}) {
  const { session, isLoading: sessionLoading } = useSession();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLead, setNewLead] = useState<NewLeadForm>(emptyForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof NewLeadForm, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (minScore.trim()) params.set('minScore', minScore.trim());
      if (projectId) params.set('projectId', projectId);
      const query = params.toString();
      const res = await fetch(`/api/leads${query ? `?${query}` : ''}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to load leads');
        return;
      }
      const data: Lead[] = await res.json();
      setLeads(data);
    } catch {
      setError('Network error loading leads');
    } finally {
      setLoading(false);
    }
  }, [session, minScore, projectId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  function validateNewLead(): boolean {
    const errors: Partial<Record<keyof NewLeadForm, string>> = {};
    if (!newLead.name.trim()) errors.name = 'Name is required';
    if (!newLead.role.trim()) errors.role = 'Role is required';
    if (!newLead.company.trim()) errors.company = 'Company is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleAddLead(e: FormEvent) {
    e.preventDefault();
    if (!validateNewLead()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newLead.name.trim(),
          role: newLead.role.trim(),
          company: newLead.company.trim(),
          industry: newLead.industry.trim() || undefined,
          geography: newLead.geography.trim() || undefined,
        }),
      });

      if (res.status === 409) {
        const err: ApiError & { details?: Record<string, string> } = await res.json();
        const existingId = err.details?.existingLeadId;
        setToast({
          type: 'error',
          message: err.message,
          linkTo: existingId,
          linkLabel: 'View existing lead',
        });
        return;
      }

      if (!res.ok) {
        const err: ApiError = await res.json();
        setToast({ type: 'error', message: err.message });
        return;
      }

      setNewLead(emptyForm);
      setShowAddForm(false);
      setToast({ type: 'success', message: 'Lead added successfully' });
      fetchLeads();
    } catch {
      setToast({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setToast({
          type: 'info',
          message: 'Lead deleted.',
          linkTo: id,
          linkLabel: 'Undo',
        });
        fetchLeads();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete lead.' });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRestore(id: string) {
    try {
      const res = await fetch(`/api/leads/${id}/restore`, { method: 'POST' });
      if (res.ok) {
        setToast({ type: 'success', message: 'Lead restored.' });
        fetchLeads();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to restore lead.' });
    }
  }

  if (sessionLoading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && leads.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={fetchLeads}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Leads</h2>
        <div className="flex items-center gap-3">
          <label htmlFor="minScoreFilter" className="text-sm font-medium">
            Min Score:
          </label>
          <Input
            id="minScoreFilter"
            type="number"
            min={1}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            placeholder="0"
            className="w-20"
          />
          <Button
            variant={showAddForm ? 'outline' : 'default'}
            size="sm"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? 'Cancel' : '+ Add Lead'}
          </Button>
        </div>
      </div>

      {toast && (
        <Alert variant={toast.type === 'error' ? 'destructive' : 'default'} role="status">
          <AlertDescription className="flex items-center justify-between">
            <span>{toast.message}</span>
            {toast.linkTo && toast.linkLabel && (
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  if (toast.type === 'info') handleRestore(toast.linkTo!);
                  else if (onSelectLead) onSelectLead(toast.linkTo!);
                  setToast(null);
                }}
              >
                {toast.linkLabel}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add New Lead</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddLead} noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <label htmlFor="new-lead-name" className="text-sm font-medium">
                    Name <span aria-hidden="true">*</span>
                  </label>
                  <Input
                    id="new-lead-name"
                    type="text"
                    value={newLead.name}
                    onChange={(e) => {
                      setNewLead((p) => ({ ...p, name: e.target.value }));
                      setFormErrors((p) => ({ ...p, name: undefined }));
                    }}
                    aria-required="true"
                    aria-invalid={!!formErrors.name}
                    aria-describedby={formErrors.name ? 'new-lead-name-error' : undefined}
                  />
                  {formErrors.name && (
                    <span
                      id="new-lead-name-error"
                      className="text-sm text-destructive"
                      role="alert"
                    >
                      {formErrors.name}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-lead-role" className="text-sm font-medium">
                    Role <span aria-hidden="true">*</span>
                  </label>
                  <Input
                    id="new-lead-role"
                    type="text"
                    value={newLead.role}
                    onChange={(e) => {
                      setNewLead((p) => ({ ...p, role: e.target.value }));
                      setFormErrors((p) => ({ ...p, role: undefined }));
                    }}
                    aria-required="true"
                    aria-invalid={!!formErrors.role}
                    aria-describedby={formErrors.role ? 'new-lead-role-error' : undefined}
                  />
                  {formErrors.role && (
                    <span
                      id="new-lead-role-error"
                      className="text-sm text-destructive"
                      role="alert"
                    >
                      {formErrors.role}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-lead-company" className="text-sm font-medium">
                    Company <span aria-hidden="true">*</span>
                  </label>
                  <Input
                    id="new-lead-company"
                    type="text"
                    value={newLead.company}
                    onChange={(e) => {
                      setNewLead((p) => ({ ...p, company: e.target.value }));
                      setFormErrors((p) => ({ ...p, company: undefined }));
                    }}
                    aria-required="true"
                    aria-invalid={!!formErrors.company}
                    aria-describedby={formErrors.company ? 'new-lead-company-error' : undefined}
                  />
                  {formErrors.company && (
                    <span
                      id="new-lead-company-error"
                      className="text-sm text-destructive"
                      role="alert"
                    >
                      {formErrors.company}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor="new-lead-industry" className="text-sm font-medium">
                    Industry
                  </label>
                  <Input
                    id="new-lead-industry"
                    type="text"
                    value={newLead.industry}
                    onChange={(e) => setNewLead((p) => ({ ...p, industry: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-lead-geography" className="text-sm font-medium">
                    Geography
                  </label>
                  <Input
                    id="new-lead-geography"
                    type="text"
                    value={newLead.geography}
                    onChange={(e) => setNewLead((p) => ({ ...p, geography: e.target.value }))}
                  />
                </div>
              </div>
              <div className="mt-4">
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Adding...' : 'Add Lead'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3" role="status" aria-live="polite">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-lg font-medium text-muted-foreground">No leads found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your first lead to get started.
            </p>
            {!showAddForm && (
              <Button className="mt-4" onClick={() => setShowAddForm(true)}>
                + Add Lead
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Geography</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Correlation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    onClick={() => onSelectLead?.(lead.id)}
                    className={onSelectLead ? 'cursor-pointer' : ''}
                  >
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    <TableCell>{lead.email ?? '—'}</TableCell>
                    <TableCell>{lead.role}</TableCell>
                    <TableCell>{lead.company}</TableCell>
                    <TableCell>{lead.industry ?? '—'}</TableCell>
                    <TableCell>{lead.geography ?? '—'}</TableCell>
                    <TableCell>
                      <span
                        title={`ICP: ${lead.scoreBreakdown.icpMatch} | Role: ${lead.scoreBreakdown.roleRelevance} | Intent: ${lead.scoreBreakdown.intentSignals}`}
                      >
                        {lead.leadScore}
                      </span>
                    </TableCell>
                    <TableCell>
                      {lead.correlationScore != null ? (
                        <Badge variant={lead.correlationFlag ? 'destructive' : 'secondary'}>
                          {(lead.correlationScore * 100).toFixed(0)}%
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{lead.crmStatus}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deletingId === lead.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(lead.id);
                        }}
                        aria-label={`Delete ${lead.name}`}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
