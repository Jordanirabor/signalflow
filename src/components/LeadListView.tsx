'use client';

import { FOUNDER_ID } from '@/lib/constants';
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

export default function LeadListView({ onSelectLead }: { onSelectLead?: (id: string) => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [minScore, setMinScore] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLead, setNewLead] = useState<NewLeadForm>(emptyForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof NewLeadForm, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ founderId: FOUNDER_ID });
      if (minScore.trim()) params.set('minScore', minScore.trim());
      const res = await fetch(`/api/leads?${params}`);
      if (res.ok) {
        const data: Lead[] = await res.json();
        setLeads(data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [minScore]);

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
          founderId: FOUNDER_ID,
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

  function ScoreBreakdownTooltip({ lead }: { lead: Lead }) {
    return (
      <span
        className="score-cell"
        title={`ICP: ${lead.scoreBreakdown.icpMatch} | Role: ${lead.scoreBreakdown.roleRelevance} | Intent: ${lead.scoreBreakdown.intentSignals}`}
      >
        {lead.leadScore}
      </span>
    );
  }

  return (
    <div className="lead-list-view">
      <div className="lead-list-header">
        <h2>Leads</h2>
        <div className="lead-list-controls">
          <label htmlFor="minScoreFilter">Min Score:</label>
          <input
            id="minScoreFilter"
            type="number"
            min={1}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            placeholder="0"
            style={{ width: 70 }}
          />
          <button type="button" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? 'Cancel' : '+ Add Lead'}
          </button>
        </div>
      </div>

      {toast && (
        <div className={`toast toast-${toast.type}`} role="status">
          {toast.message}
          {toast.linkTo && toast.linkLabel && (
            <button
              type="button"
              className="toast-link"
              onClick={() => {
                if (toast.type === 'info') handleRestore(toast.linkTo!);
                else if (onSelectLead) onSelectLead(toast.linkTo!);
                setToast(null);
              }}
            >
              {toast.linkLabel}
            </button>
          )}
        </div>
      )}

      {showAddForm && (
        <form onSubmit={handleAddLead} className="add-lead-form" noValidate>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="new-lead-name">
                Name <span aria-hidden="true">*</span>
              </label>
              <input
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
                <span id="new-lead-name-error" className="field-error" role="alert">
                  {formErrors.name}
                </span>
              )}
            </div>
            <div className="form-field">
              <label htmlFor="new-lead-role">
                Role <span aria-hidden="true">*</span>
              </label>
              <input
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
                <span id="new-lead-role-error" className="field-error" role="alert">
                  {formErrors.role}
                </span>
              )}
            </div>
            <div className="form-field">
              <label htmlFor="new-lead-company">
                Company <span aria-hidden="true">*</span>
              </label>
              <input
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
                <span id="new-lead-company-error" className="field-error" role="alert">
                  {formErrors.company}
                </span>
              )}
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="new-lead-industry">Industry</label>
              <input
                id="new-lead-industry"
                type="text"
                value={newLead.industry}
                onChange={(e) => setNewLead((p) => ({ ...p, industry: e.target.value }))}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-lead-geography">Geography</label>
              <input
                id="new-lead-geography"
                type="text"
                value={newLead.geography}
                onChange={(e) => setNewLead((p) => ({ ...p, geography: e.target.value }))}
              />
            </div>
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add Lead'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="lead-list-loading">Loading leads...</div>
      ) : leads.length === 0 ? (
        <div className="lead-list-empty">No leads found. Add your first lead above.</div>
      ) : (
        <table className="lead-table" role="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Company</th>
              <th scope="col">Industry</th>
              <th scope="col">Geography</th>
              <th scope="col">Score</th>
              <th scope="col">Correlation</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => onSelectLead?.(lead.id)}
                style={{ cursor: onSelectLead ? 'pointer' : undefined }}
              >
                <td>{lead.name}</td>
                <td>{lead.email ?? '—'}</td>
                <td>{lead.role}</td>
                <td>{lead.company}</td>
                <td>{lead.industry ?? '—'}</td>
                <td>{lead.geography ?? '—'}</td>
                <td>
                  <ScoreBreakdownTooltip lead={lead} />
                </td>
                <td>
                  {lead.correlationScore != null ? (
                    <span
                      className={`correlation-cell ${lead.correlationFlag ? 'correlation-cell-low' : 'correlation-cell-good'}`}
                      title={
                        lead.correlationFlag
                          ? 'Low correlation — excluded from auto-outreach'
                          : 'Good correlation with ICP'
                      }
                    >
                      {(lead.correlationScore * 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="correlation-cell-none">—</span>
                  )}
                </td>
                <td>
                  <span className={`status-badge status-${lead.crmStatus.toLowerCase()}`}>
                    {lead.crmStatus}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-delete"
                    disabled={deletingId === lead.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(lead.id);
                    }}
                    aria-label={`Delete ${lead.name}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
