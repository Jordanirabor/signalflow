'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { ApiError, OutreachRecord, ThrottleStatus } from '@/types';
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
}

export default function OutreachTracker({ leadId, prefillMessage }: OutreachTrackerProps) {
  // Form state
  const [channel, setChannel] = useState<'email' | 'dm'>('email');
  const [messageContent, setMessageContent] = useState(prefillMessage ?? '');
  const [isFollowUp, setIsFollowUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

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
    try {
      const res = await fetch(`/api/throttle/status?founderId=${FOUNDER_ID}`);
      if (res.ok) {
        const data: ThrottleStatusMap = await res.json();
        setThrottle(data);
      }
    } catch {
      /* silent */
    }
  }, []);

  const fetchHistory = useCallback(async () => {
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
  }, [leadId]);

  useEffect(() => {
    fetchThrottleStatus();
    fetchHistory();
  }, [fetchThrottleStatus, fetchHistory]);

  async function fetchStaleLeads() {
    setStaleLoading(true);
    try {
      const res = await fetch(`/api/outreach/stale?founderId=${FOUNDER_ID}`);
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
          founderId: FOUNDER_ID,
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

  return (
    <div className="outreach-tracker">
      <h3>Record Outreach</h3>

      {/* Throttle warning banner */}
      {isWarning && !isBlocked && currentThrottle && (
        <div className="toast toast-warning" role="status" aria-live="polite">
          ⚠️ You have used {currentThrottle.used} of {currentThrottle.limit} daily {channel}{' '}
          outreach actions. {currentThrottle.remaining} remaining.
        </div>
      )}

      {/* Throttle blocked banner */}
      {isBlocked && currentThrottle && (
        <div className="toast toast-error" role="alert">
          Daily {channel} outreach limit reached ({currentThrottle.limit}). Try again tomorrow.
        </div>
      )}

      <form onSubmit={handleSubmit} className="outreach-form" noValidate>
        <fieldset className="form-field">
          <legend className="form-field-legend">Channel</legend>
          <div className="outreach-channel-options">
            <label className="outreach-radio-label">
              <input
                type="radio"
                name="outreach-channel"
                value="email"
                checked={channel === 'email'}
                onChange={() => setChannel('email')}
              />
              Email
            </label>
            <label className="outreach-radio-label">
              <input
                type="radio"
                name="outreach-channel"
                value="dm"
                checked={channel === 'dm'}
                onChange={() => setChannel('dm')}
              />
              DM
            </label>
          </div>
        </fieldset>

        <div className="form-field">
          <label htmlFor="outreach-message">
            Message Content <span aria-hidden="true">*</span>
          </label>
          <textarea
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
            <span id="outreach-message-error" className="field-error" role="alert">
              {formError}
            </span>
          )}
        </div>

        <div className="form-field outreach-follow-up-field">
          <label className="outreach-checkbox-label">
            <input
              type="checkbox"
              checked={isFollowUp}
              onChange={(e) => setIsFollowUp(e.target.checked)}
            />
            This is a follow-up
          </label>
        </div>

        <button
          type="submit"
          className="action-btn"
          disabled={submitting || isBlocked}
          aria-disabled={isBlocked}
        >
          {submitting ? 'Recording...' : 'Record Outreach'}
        </button>

        {formError && formError !== 'Message content is required' && (
          <div className="form-feedback error" role="alert">
            {formError}
          </div>
        )}

        {formSuccess && (
          <div className="form-feedback success" role="status">
            {formSuccess}
          </div>
        )}
      </form>

      {/* Outreach History */}
      <section className="lead-info-section outreach-history-section" aria-label="Outreach History">
        <h3>Outreach History</h3>
        {historyLoading ? (
          <p className="empty-state">Loading outreach history...</p>
        ) : history.length === 0 ? (
          <p className="empty-state">No outreach recorded yet.</p>
        ) : (
          <ul className="outreach-list">
            {history.map((o) => (
              <li key={o.id} className="outreach-item">
                <span className="outreach-date">
                  {new Date(o.outreachDate).toLocaleDateString()}
                </span>
                <span className={`channel-badge channel-${o.channel}`}>{o.channel}</span>
                {o.isFollowUp && <span className="follow-up-badge">Follow-up</span>}
                <p className="outreach-content">{o.messageContent}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Stale Leads */}
      <section className="lead-info-section stale-leads-section" aria-label="Stale Leads">
        <div className="stale-leads-header">
          <h3>Stale Leads</h3>
          <button type="button" className="action-btn stale-toggle-btn" onClick={handleToggleStale}>
            {showStale ? 'Hide' : 'Show'} Stale Leads
          </button>
        </div>
        {showStale && (
          <>
            {staleLoading ? (
              <p className="empty-state">Loading stale leads...</p>
            ) : staleLeads.length === 0 ? (
              <p className="empty-state">No stale leads found.</p>
            ) : (
              <ul className="stale-leads-list">
                {staleLeads.map((lead) => (
                  <li key={lead.leadId} className="stale-lead-item">
                    <div className="stale-lead-info">
                      <span className="stale-lead-name">{lead.leadName}</span>
                      <span className="stale-lead-company">{lead.company}</span>
                      <span className={`status-badge status-${lead.crmStatus.toLowerCase()}`}>
                        {lead.crmStatus}
                      </span>
                    </div>
                    <span className="stale-lead-days">
                      {daysSince(lead.lastOutreachDate)} days since last outreach
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
