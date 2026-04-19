'use client';

import {
  buildSubmissionPayload,
  mapPersonToForm,
  validateLeadForm,
  type NewLeadForm,
} from '@/components/autofillMapping';
import { ICPProfileSelector } from '@/components/ICPProfileSelector';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebounce } from '@/hooks/useDebounce';
import { useSession } from '@/hooks/useSession';
import { formatICPProfileLabel } from '@/lib/icpProfileLabel';
import type { PersonSearchResult } from '@/services/peopleSearchService';
import type { ApiError, ICPProfile, ICPProject, ICPSet, Lead } from '@/types';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

interface Toast {
  type: 'success' | 'error' | 'info';
  message: string;
  linkTo?: string;
  linkLabel?: string;
}

const ALL_PROJECTS_VALUE = '__all_projects__';

const emptyForm: NewLeadForm = {
  name: '',
  role: '',
  company: '',
  industry: '',
  geography: '',
  email: '',
};

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
  const [selectedIcpProfileId, setSelectedIcpProfileId] = useState<string | null>(null);
  const [profileMap, setProfileMap] = useState<Map<string, ICPProfile>>(new Map());

  // Project filter state — defaults to the currently selected project from ProjectContext
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(
    projectId ?? null,
  );
  const [projects, setProjects] = useState<ICPProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // Search state for name-based people search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PersonSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<PersonSearchResult | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Fetch search results when debounced query changes
  useEffect(() => {
    if (debouncedSearchQuery.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    let cancelled = false;

    async function fetchSearchResults() {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(debouncedSearchQuery)}`);
        if (!res.ok) {
          setSearchResults([]);
          return;
        }
        const data: { results: PersonSearchResult[] } = await res.json();
        if (!cancelled) {
          setSearchResults(data.results);
          setShowDropdown(true);
          setHighlightedIndex(0);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }

    fetchSearchResults();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearchQuery]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // Fetch projects on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchProjects() {
      setProjectsLoading(true);
      try {
        const res = await fetch('/api/projects');
        if (res.ok) {
          const data: ICPProject[] = await res.json();
          if (!cancelled) {
            setProjects(data);
          }
        }
      } catch {
        // Silently handle — project filter will just be empty
      } finally {
        if (!cancelled) {
          setProjectsLoading(false);
        }
      }
    }

    fetchProjects();

    return () => {
      cancelled = true;
    };
  }, []);

  // Sync selectedProjectFilter when the external projectId prop changes
  useEffect(() => {
    setSelectedProjectFilter(projectId ?? null);
  }, [projectId]);

  // The effective projectId used for fetching leads and scoping the ICP selector
  const effectiveProjectId = selectedProjectFilter;

  const fetchLeads = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (minScore.trim()) params.set('minScore', minScore.trim());
      if (effectiveProjectId) params.set('projectId', effectiveProjectId);
      if (selectedIcpProfileId) params.set('icpProfileId', selectedIcpProfileId);
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
  }, [session, minScore, effectiveProjectId, selectedIcpProfileId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Reset ICP profile filter when project filter changes
  useEffect(() => {
    setSelectedIcpProfileId(null);
  }, [effectiveProjectId]);

  // Fetch ICP profiles for the current project to build a lookup map
  useEffect(() => {
    if (!effectiveProjectId) {
      setProfileMap(new Map());
      return;
    }

    let cancelled = false;

    async function fetchProfiles() {
      try {
        const res = await fetch(`/api/icp/profiles?projectId=${effectiveProjectId}`);
        if (res.ok) {
          const data: ICPSet = await res.json();
          if (!cancelled) {
            const map = new Map<string, ICPProfile>();
            for (const p of data.profiles) {
              map.set(p.id, p);
            }
            setProfileMap(map);
          }
        }
      } catch {
        // Silently handle — column will show "—" if profiles can't be loaded
      }
    }

    fetchProfiles();

    return () => {
      cancelled = true;
    };
  }, [effectiveProjectId]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  function handleSelectPerson(person: PersonSearchResult) {
    setNewLead(mapPersonToForm(person));
    setSelectedPerson(person);
    setShowDropdown(false);
    setFormErrors({});
  }

  function handleProjectFilterChange(value: string) {
    const newProjectId = value === ALL_PROJECTS_VALUE ? null : value;
    setSelectedProjectFilter(newProjectId);
    // Reset ICP profile filter when project changes (also handled by the effect, but immediate for UX)
    setSelectedIcpProfileId(null);
  }

  function handleNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && searchResults.length > 0) {
      e.preventDefault();
      handleSelectPerson(searchResults[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  function validateNewLead(): boolean {
    const errors = validateLeadForm(newLead, !!selectedPerson);
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
          ...buildSubmissionPayload(newLead),
          projectId: effectiveProjectId ?? undefined,
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
      setSelectedPerson(null);
      setSearchQuery('');
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
          <Select
            value={selectedProjectFilter ?? ALL_PROJECTS_VALUE}
            onValueChange={handleProjectFilterChange}
            disabled={projectsLoading}
          >
            <SelectTrigger className="w-[200px]" aria-label="Filter by project">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS_VALUE}>All Projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ICPProfileSelector
            projectId={effectiveProjectId ?? null}
            value={selectedIcpProfileId}
            onChange={setSelectedIcpProfileId}
          />
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
                <div className="space-y-1" ref={dropdownRef} style={{ position: 'relative' }}>
                  <label htmlFor="new-lead-name" className="text-sm font-medium">
                    Name <span aria-hidden="true">*</span>
                  </label>
                  <div className="relative">
                    <Input
                      id="new-lead-name"
                      type="text"
                      placeholder="Search by name..."
                      value={newLead.name}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewLead((p) => ({ ...p, name: value }));
                        setSearchQuery(value);
                        setFormErrors((p) => ({ ...p, name: undefined }));
                      }}
                      onKeyDown={handleNameKeyDown}
                      aria-required="true"
                      aria-invalid={!!formErrors.name}
                      aria-describedby={formErrors.name ? 'new-lead-name-error' : undefined}
                      autoComplete="off"
                    />
                    {isSearching && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        Searching…
                      </span>
                    )}
                  </div>
                  {formErrors.name && (
                    <span
                      id="new-lead-name-error"
                      className="text-sm text-destructive"
                      role="alert"
                    >
                      {formErrors.name}
                    </span>
                  )}
                  {showDropdown && (
                    <ul
                      className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md"
                      role="listbox"
                    >
                      {searchResults.length === 0 && searchQuery.length >= 2 && !isSearching ? (
                        <li className="px-3 py-2 text-sm text-muted-foreground">
                          No matches found
                        </li>
                      ) : (
                        searchResults.map((result, index) => (
                          <li
                            key={`${result.name}-${result.email}-${index}`}
                            role="option"
                            aria-selected={index === highlightedIndex}
                            className={`cursor-pointer px-3 py-2 text-sm ${
                              index === highlightedIndex ? 'bg-accent text-accent-foreground' : ''
                            }`}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            onClick={() => {
                              handleSelectPerson(result);
                            }}
                          >
                            <div className="font-medium">{result.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {result.role}
                              {result.company ? ` at ${result.company}` : ''}
                              {result.email ? ` · ${result.email}` : ''}
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-lead-role" className="text-sm font-medium">
                    Role
                  </label>
                  <Input
                    id="new-lead-role"
                    type="text"
                    value={newLead.role}
                    onChange={(e) => {
                      setNewLead((p) => ({ ...p, role: e.target.value }));
                      setFormErrors((p) => ({ ...p, role: undefined }));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-lead-company" className="text-sm font-medium">
                    Company
                  </label>
                  <Input
                    id="new-lead-company"
                    type="text"
                    value={newLead.company}
                    onChange={(e) => {
                      setNewLead((p) => ({ ...p, company: e.target.value }));
                      setFormErrors((p) => ({ ...p, company: undefined }));
                    }}
                  />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                <div className="space-y-1">
                  <label htmlFor="new-lead-email" className="text-sm font-medium">
                    Email
                  </label>
                  <Input
                    id="new-lead-email"
                    type="email"
                    value={newLead.email}
                    onChange={(e) => setNewLead((p) => ({ ...p, email: e.target.value }))}
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
                  <TableHead>ICP Profile</TableHead>
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
                      {lead.icpProfileId && profileMap.has(lead.icpProfileId)
                        ? formatICPProfileLabel(profileMap.get(lead.icpProfileId)!)
                        : '—'}
                    </TableCell>
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
