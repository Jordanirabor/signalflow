'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { ApiError, CRMStatus } from '@/types';
import { CRM_PIPELINE_ORDER } from '@/types';
import { useCallback, useEffect, useState } from 'react';
const PIPELINE_STATUSES: CRMStatus[] = ['New', 'Contacted', 'Replied', 'Booked', 'Closed'];

interface PipelineLead {
  id: string;
  founderId: string;
  name: string;
  role: string;
  company: string;
  industry?: string;
  geography?: string;
  leadScore: number;
  scoreBreakdown: { icpMatch: number; roleRelevance: number; intentSignals: number };
  enrichmentStatus: 'pending' | 'complete' | 'partial';
  crmStatus: CRMStatus;
  createdAt: string;
  updatedAt: string;
  lastActivity: string;
}

interface PipelineView {
  counts: Record<CRMStatus, number>;
  leads: PipelineLead[];
}

interface Filters {
  status: string;
  minScore: string;
  maxScore: string;
  lastActivityAfter: string;
}

const emptyFilters: Filters = { status: '', minScore: '', maxScore: '', lastActivityAfter: '' };

export default function CRMPipelineView() {
  const [pipeline, setPipeline] = useState<PipelineView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);

  const fetchPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ founderId: FOUNDER_ID });
      if (filters.status) params.set('status', filters.status);
      if (filters.minScore.trim()) params.set('minScore', filters.minScore.trim());
      if (filters.maxScore.trim()) params.set('maxScore', filters.maxScore.trim());
      if (filters.lastActivityAfter) params.set('lastActivityAfter', filters.lastActivityAfter);

      const res = await fetch(`/api/crm/pipeline?${params}`);
      if (!res.ok) {
        const err: ApiError = await res.json();
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
  }, [filters]);

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  useEffect(() => {
    if (transitionError) {
      const t = setTimeout(() => setTransitionError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [transitionError]);

  async function handleStatusTransition(lead: PipelineLead, toStatus: CRMStatus) {
    setTransitionError(null);
    const fromOrder = CRM_PIPELINE_ORDER[lead.crmStatus];
    const toOrder = CRM_PIPELINE_ORDER[toStatus];
    const isBackward = toOrder < fromOrder;

    let reason: string | undefined;
    let meetingDate: string | undefined;

    if (isBackward) {
      const input = window.prompt(
        `Moving ${lead.name} backward from ${lead.crmStatus} to ${toStatus}. Please provide a reason:`,
      );
      if (!input || !input.trim()) {
        setTransitionError('A reason is required when moving a lead backward in the pipeline');
        return;
      }
      reason = input.trim();
    }

    if (toStatus === 'Booked') {
      const input = window.prompt(
        `Enter meeting date and time for ${lead.name} (e.g. 2025-01-15T10:00):`,
      );
      if (!input || !input.trim()) {
        setTransitionError('A meeting date is required when moving a lead to Booked status');
        return;
      }
      const parsed = new Date(input.trim());
      if (isNaN(parsed.getTime())) {
        setTransitionError('Invalid date format. Please use ISO format (e.g. 2025-01-15T10:00)');
        return;
      }
      meetingDate = input.trim();
    }

    setTransitioningId(lead.id);
    try {
      const body: Record<string, string> = { toStatus };
      if (reason) body.reason = reason;
      if (meetingDate) body.meetingDate = meetingDate;

      const res = await fetch(`/api/crm/${lead.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err: ApiError = await res.json();
        setTransitionError(err.message ?? 'Failed to update status');
        return;
      }

      fetchPipeline();
    } catch {
      setTransitionError('Network error updating status');
    } finally {
      setTransitioningId(null);
    }
  }

  function getAdjacentStatuses(status: CRMStatus): { prev?: CRMStatus; next?: CRMStatus } {
    const idx = PIPELINE_STATUSES.indexOf(status);
    return {
      prev: idx > 0 ? PIPELINE_STATUSES[idx - 1] : undefined,
      next: idx < PIPELINE_STATUSES.length - 1 ? PIPELINE_STATUSES[idx + 1] : undefined,
    };
  }

  function leadsForStatus(status: CRMStatus): PipelineLead[] {
    if (!pipeline) return [];
    return pipeline.leads.filter((l) => l.crmStatus === status);
  }

  const visibleStatuses = filters.status
    ? PIPELINE_STATUSES.filter((s) => s === filters.status)
    : PIPELINE_STATUSES;

  return (
    <section className="pipeline-view" aria-label="CRM Pipeline">
      <h2 className="pipeline-title">CRM Pipeline</h2>

      {/* Filters */}
      <div className="pipeline-filters" role="search" aria-label="Pipeline filters">
        <div className="form-field">
          <label htmlFor="pipeline-filter-status">Status</label>
          <select
            id="pipeline-filter-status"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">All</option>
            {PIPELINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="pipeline-filter-min-score">Min Score</label>
          <input
            id="pipeline-filter-min-score"
            type="number"
            min={1}
            max={100}
            value={filters.minScore}
            onChange={(e) => setFilters((f) => ({ ...f, minScore: e.target.value }))}
            placeholder="1"
          />
        </div>
        <div className="form-field">
          <label htmlFor="pipeline-filter-max-score">Max Score</label>
          <input
            id="pipeline-filter-max-score"
            type="number"
            min={1}
            max={100}
            value={filters.maxScore}
            onChange={(e) => setFilters((f) => ({ ...f, maxScore: e.target.value }))}
            placeholder="100"
          />
        </div>
        <div className="form-field">
          <label htmlFor="pipeline-filter-activity">Last Activity After</label>
          <input
            id="pipeline-filter-activity"
            type="date"
            value={filters.lastActivityAfter}
            onChange={(e) => setFilters((f) => ({ ...f, lastActivityAfter: e.target.value }))}
          />
        </div>
      </div>

      {/* Transition error toast */}
      {transitionError && (
        <div className="toast toast-error" role="alert">
          {transitionError}
        </div>
      )}

      {/* Loading / Error states */}
      {loading && <div className="pipeline-loading">Loading pipeline...</div>}
      {error && !loading && (
        <div className="toast toast-error" role="alert">
          {error}
        </div>
      )}

      {/* Kanban board */}
      {!loading && pipeline && (
        <div className="pipeline-board" role="region" aria-label="Pipeline columns">
          {visibleStatuses.map((status) => {
            const leads = leadsForStatus(status);
            const count = pipeline.counts[status] ?? 0;
            return (
              <section key={status} className="pipeline-column" aria-label={`${status} column`}>
                <header className="pipeline-column-header">
                  <h3 className="pipeline-column-title">{status}</h3>
                  <span className="pipeline-column-count" aria-label={`${count} leads`}>
                    {count}
                  </span>
                </header>
                <ul className="pipeline-card-list" aria-label={`${status} leads`}>
                  {leads.length === 0 ? (
                    <li className="pipeline-empty">No leads</li>
                  ) : (
                    leads.map((lead) => {
                      const { prev, next } = getAdjacentStatuses(status);
                      const isTransitioning = transitioningId === lead.id;
                      return (
                        <li key={lead.id} className="pipeline-card">
                          <div className="pipeline-card-name">{lead.name}</div>
                          <div className="pipeline-card-company">{lead.company}</div>
                          <div className="pipeline-card-score">
                            <span
                              className="score-cell"
                              title={`ICP: ${lead.scoreBreakdown.icpMatch} | Role: ${lead.scoreBreakdown.roleRelevance} | Intent: ${lead.scoreBreakdown.intentSignals}`}
                            >
                              Score: {lead.leadScore}
                            </span>
                          </div>
                          <div className="pipeline-card-actions">
                            {prev && (
                              <button
                                type="button"
                                className="pipeline-move-btn"
                                disabled={isTransitioning}
                                onClick={() => handleStatusTransition(lead, prev)}
                                aria-label={`Move ${lead.name} to ${prev}`}
                              >
                                ← {prev}
                              </button>
                            )}
                            {next && (
                              <button
                                type="button"
                                className="pipeline-move-btn"
                                disabled={isTransitioning}
                                onClick={() => handleStatusTransition(lead, next)}
                                aria-label={`Move ${lead.name} to ${next}`}
                              >
                                {next} →
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
