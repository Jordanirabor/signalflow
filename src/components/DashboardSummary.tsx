'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { CRMStatus, Lead, UpcomingMeeting, WeeklySummary } from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';
const CRM_STATUSES: CRMStatus[] = ['New', 'Contacted', 'Replied', 'Booked', 'Closed'];

export default function DashboardSummary() {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadStart = useRef<number>(0);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    loadStart.current = performance.now();
    try {
      const res = await fetch(`/api/dashboard/summary?founderId=${FOUNDER_ID}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to load dashboard');
        return;
      }
      const data: WeeklySummary = await res.json();
      setSummary(data);

      // PostHog analytics tracking (Req 8.3)
      try {
        const posthog = await import('posthog-js');
        if (posthog.default) {
          const loadTime = performance.now() - loadStart.current;
          posthog.default.capture('dashboard_loaded', {
            load_time_ms: Math.round(loadTime),
            leads_contacted: data.leadsContacted,
            meetings_booked: data.meetingsBooked,
          });
        }
      } catch {
        /* PostHog unavailable — silent */
      }
    } catch {
      setError('Network error loading dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  function formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  function formatMeetingDate(meeting: UpcomingMeeting): string {
    const d = new Date(meeting.date);
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  if (loading) {
    return (
      <div className="dashboard-loading" role="status" aria-live="polite">
        Loading dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error" role="alert">
        <p>{error}</p>
        <button type="button" className="action-btn" onClick={fetchSummary}>
          Retry
        </button>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="dashboard-summary">
      <h2>Weekly Dashboard</h2>

      {/* Weekly Metrics (Req 8.1) */}
      <section className="dashboard-metrics" aria-label="Weekly metrics">
        <div className="metric-card">
          <span className="metric-value">{summary.leadsContacted}</span>
          <span className="metric-label">Leads Contacted</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{formatPercent(summary.replyRate)}</span>
          <span className="metric-label">Reply Rate</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{summary.meetingsBooked}</span>
          <span className="metric-label">Meetings Booked</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{formatPercent(summary.conversionRate)}</span>
          <span className="metric-label">Conversion Rate</span>
        </div>
      </section>

      {/* CRM Status Counts (Req 8.2) */}
      <section className="dashboard-status-counts" aria-label="CRM status counts">
        <h3>Pipeline Overview</h3>
        <div className="status-counts-grid">
          {CRM_STATUSES.map((status) => (
            <div key={status} className="status-count-card">
              <span className="status-count-value">{summary.statusCounts[status] ?? 0}</span>
              <span className={`status-count-label status-${status.toLowerCase()}`}>{status}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Low Meeting Prompt (Req 8.6) */}
      {summary.lowMeetingPrompt && summary.lowMeetingPrompt.length > 0 && (
        <section
          className="dashboard-low-meeting-prompt"
          aria-label="Low meeting prompt"
          role="alert"
        >
          <h3>📅 You have fewer than 3 meetings this week</h3>
          <p>Consider reaching out to these high-scoring leads:</p>
          <ul className="suggestion-list">
            {summary.lowMeetingPrompt.map((lead: Lead) => (
              <li key={lead.id} className="suggestion-item">
                <span className="suggestion-name">{lead.name}</span>
                <span className="suggestion-company">{lead.company}</span>
                <span className="suggestion-score">Score: {lead.leadScore}</span>
                <span className={`status-badge status-${lead.crmStatus.toLowerCase()}`}>
                  {lead.crmStatus}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Upcoming Meetings (Req 8.4) */}
      <section className="dashboard-upcoming-meetings" aria-label="Upcoming meetings">
        <h3>Upcoming Meetings</h3>
        {summary.upcomingMeetings.length === 0 ? (
          <p className="empty-state">No upcoming meetings scheduled.</p>
        ) : (
          <ul className="meetings-list">
            {summary.upcomingMeetings.map((meeting: UpcomingMeeting, i: number) => (
              <li key={i} className="meeting-item">
                <span className="meeting-lead">{meeting.leadName}</span>
                <span className="meeting-date">{formatMeetingDate(meeting)}</span>
                <span className="meeting-time">{meeting.time}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* High-Priority Suggestions (Req 8.5) */}
      <section className="dashboard-high-priority" aria-label="High-priority suggestions">
        <h3>🔥 High-Priority Leads</h3>
        {summary.highPrioritySuggestions.length === 0 ? (
          <p className="empty-state">No high-priority leads to suggest right now.</p>
        ) : (
          <ul className="suggestion-list">
            {summary.highPrioritySuggestions.map((lead: Lead) => (
              <li key={lead.id} className="suggestion-item suggestion-high-priority">
                <span className="suggestion-name">{lead.name}</span>
                <span className="suggestion-company">{lead.company}</span>
                <span className="suggestion-role">{lead.role}</span>
                <span className="suggestion-score">Score: {lead.leadScore}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
