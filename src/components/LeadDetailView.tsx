'use client';

import type {
  CallNote,
  CorrelationBreakdown,
  CRMStatus,
  Lead,
  OutreachRecord,
  ResearchProfile,
} from '@/types';
import { useCallback, useEffect, useState } from 'react';
const CRM_STATUSES: CRMStatus[] = ['New', 'Contacted', 'Replied', 'Booked', 'Closed'];

export default function LeadDetailView({ leadId, onBack }: { leadId: string; onBack: () => void }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [outreach, setOutreach] = useState<OutreachRecord[]>([]);
  const [callNotes, setCallNotes] = useState<CallNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Status change state
  const [newStatus, setNewStatus] = useState<CRMStatus | ''>('');
  const [statusReason, setStatusReason] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);

  // Message generation state
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);

  // Research Profile and Correlation Score
  const [researchProfile, setResearchProfile] = useState<ResearchProfile | null>(null);
  const [correlationData, setCorrelationData] = useState<{
    total: number;
    breakdown: CorrelationBreakdown;
    flag: string | null;
  } | null>(null);
  const [refreshingResearch, setRefreshingResearch] = useState(false);

  const fetchLead = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}`);
      if (res.ok) setLead(await res.json());
      else setError('Lead not found');
    } catch {
      setError('Failed to load lead');
    }
  }, [leadId]);

  const fetchOutreach = useCallback(async () => {
    try {
      const res = await fetch(`/api/outreach/${leadId}`);
      if (res.ok) setOutreach(await res.json());
    } catch {
      /* silent */
    }
  }, [leadId]);

  const fetchCallNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/insights/${leadId}`);
      if (res.ok) setCallNotes(await res.json());
    } catch {
      /* silent */
    }
  }, [leadId]);

  const fetchResearchProfile = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}/research`);
      if (res.ok) {
        const data = await res.json();
        if (data) setResearchProfile(data);
      }
    } catch {
      /* silent */
    }
  }, [leadId]);

  const fetchCorrelation = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}/correlation`);
      if (res.ok) {
        const data = await res.json();
        if (data) setCorrelationData(data);
      }
    } catch {
      /* silent */
    }
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchLead(),
      fetchOutreach(),
      fetchCallNotes(),
      fetchResearchProfile(),
      fetchCorrelation(),
    ]).finally(() => setLoading(false));
  }, [fetchLead, fetchOutreach, fetchCallNotes, fetchResearchProfile, fetchCorrelation]);

  async function handleStatusChange() {
    if (!newStatus || !lead) return;
    setStatusError(null);
    setChangingStatus(true);
    try {
      const body: Record<string, string> = { leadId: lead.id, toStatus: newStatus };
      if (statusReason.trim()) body.reason = statusReason.trim();
      if (meetingDate) body.meetingDate = meetingDate;

      const res = await fetch(`/api/crm/${lead.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        setStatusError(err.message ?? 'Failed to change status');
        return;
      }

      setNewStatus('');
      setStatusReason('');
      setMeetingDate('');
      fetchLead();
    } catch {
      setStatusError('Network error');
    } finally {
      setChangingStatus(false);
    }
  }

  function EnrichmentBadge({ lead }: { lead: Lead }) {
    const colors: Record<string, string> = {
      complete: '#16a34a',
      partial: '#d97706',
      pending: '#6b7280',
      researching: '#3b82f6',
    };

    const sourceLabels: Record<string, string> = {
      company_website_scrape: 'Company Website',
      twitter_scrape: 'Twitter/X',
      github_scrape: 'GitHub',
      linkedin_scrape: 'LinkedIn',
      news_scrape: 'News',
      premium_api: 'Premium Data',
    };

    const formatSource = (s: string) => sourceLabels[s] ?? s.replace(/_/g, ' ');

    const statusLabels: Record<string, string> = {
      complete: 'Enriched',
      partial: 'Partially enriched',
      pending: 'Pending',
      researching: 'Researching…',
    };

    return (
      <span
        className="enrichment-badge"
        style={{ color: colors[lead.enrichmentStatus] ?? '#6b7280' }}
      >
        {statusLabels[lead.enrichmentStatus] ?? lead.enrichmentStatus}
        {lead.enrichmentStatus === 'partial' &&
          lead.enrichmentData?.failedSources &&
          lead.enrichmentData.failedSources.length > 0 && (
            <span className="failed-sources" title={lead.enrichmentData.failedSources.join(', ')}>
              {' '}
              — {lead.enrichmentData.failedSources.length} source
              {lead.enrichmentData.failedSources.length > 1 ? 's' : ''} unavailable (
              {lead.enrichmentData.failedSources.map(formatSource).join(', ')})
            </span>
          )}
      </span>
    );
  }

  if (loading) return <div className="lead-detail-loading">Loading lead details...</div>;
  if (error || !lead)
    return (
      <div className="lead-detail-error">
        {error ?? 'Lead not found'}
        <br />
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    );

  return (
    <div className="lead-detail-view">
      <button type="button" onClick={onBack} className="btn-back">
        ← Back to Leads
      </button>

      <div className="lead-detail-header">
        <h2>{lead.name}</h2>
        <span className={`status-badge status-${lead.crmStatus.toLowerCase()}`}>
          {lead.crmStatus}
        </span>
        <EnrichmentBadge lead={lead} />
      </div>

      <section className="lead-info-section">
        <h3>Details</h3>
        <dl className="lead-info-grid">
          <dt>Role</dt>
          <dd>{lead.role}</dd>
          <dt>Company</dt>
          <dd>{lead.company}</dd>
          <dt>Industry</dt>
          <dd>{lead.industry ?? '—'}</dd>
          <dt>Geography</dt>
          <dd>{lead.geography ?? '—'}</dd>
        </dl>
      </section>

      <section className="lead-info-section">
        <h3>Score Breakdown</h3>
        <div className="score-breakdown">
          <div className="score-total">Total: {lead.leadScore}</div>
          <div className="score-factors">
            <span>ICP Match: {lead.scoreBreakdown.icpMatch}/40</span>
            <span>Role Relevance: {lead.scoreBreakdown.roleRelevance}/30</span>
            <span>Intent Signals: {lead.scoreBreakdown.intentSignals}/30</span>
          </div>
        </div>
      </section>

      {lead.enrichmentData && (
        <section className="lead-info-section">
          <h3>Enrichment Data</h3>
          {lead.enrichmentData.linkedinBio && (
            <p>
              <strong>LinkedIn:</strong> {lead.enrichmentData.linkedinBio}
            </p>
          )}
          {lead.enrichmentData.companyInfo && (
            <p>
              <strong>Company:</strong> {lead.enrichmentData.companyInfo}
            </p>
          )}
          {lead.enrichmentData.recentPosts && lead.enrichmentData.recentPosts.length > 0 && (
            <div>
              <strong>Recent Posts:</strong>
              <ul>
                {lead.enrichmentData.recentPosts.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Correlation Score */}
      {correlationData && (
        <section className="lead-info-section correlation-section">
          <h3>ICP Correlation</h3>
          <div className="score-breakdown">
            <div className="score-total">
              Score: {(correlationData.total * 100).toFixed(0)}%
              {correlationData.flag && (
                <span className="correlation-warning">
                  ⚠ Low correlation — excluded from auto-outreach
                </span>
              )}
            </div>
            <div className="score-factors">
              <span>Role Fit: {(correlationData.breakdown.roleFit * 100).toFixed(0)}%</span>
              <span>
                Industry: {(correlationData.breakdown.industryAlignment * 100).toFixed(0)}%
              </span>
              <span>
                Pain Points: {(correlationData.breakdown.painPointOverlap * 100).toFixed(0)}%
              </span>
              <span>
                Buying Signals: {(correlationData.breakdown.buyingSignalStrength * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Research Profile */}
      {researchProfile && (
        <section className="lead-info-section">
          <h3>
            Research Profile
            <button
              type="button"
              className="btn-refresh"
              disabled={refreshingResearch}
              onClick={async () => {
                setRefreshingResearch(true);
                try {
                  const res = await fetch(`/api/leads/${leadId}/research/refresh`, {
                    method: 'POST',
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setResearchProfile(data);
                  }
                } catch {
                  /* silent */
                } finally {
                  setRefreshingResearch(false);
                }
              }}
            >
              {refreshingResearch ? 'Refreshing...' : '↻ Refresh'}
            </button>
          </h3>
          <p className="research-meta">
            Researched {new Date(researchProfile.researchedAt).toLocaleDateString()} · Sentiment:{' '}
            {researchProfile.overallSentiment} · Sources:{' '}
            {researchProfile.sourcesUsed.join(', ') || 'none'}
          </p>

          {researchProfile.topicsOfInterest.length > 0 && (
            <div className="research-field">
              <div className="research-field-label">Topics of Interest</div>
              <div className="research-topics">
                {researchProfile.topicsOfInterest.map((t, i) => (
                  <span key={i} className="research-topic-tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {researchProfile.currentChallenges.length > 0 && (
            <div className="research-field">
              <div className="research-field-label">Current Challenges</div>
              <ul className="research-list">
                {researchProfile.currentChallenges.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {researchProfile.recentActivity.length > 0 && (
            <div className="research-field">
              <div className="research-field-label">Recent Activity</div>
              <ul className="research-list">
                {researchProfile.recentActivity.slice(0, 5).map((a, i) => (
                  <li key={i}>
                    {a.summary}
                    <span className="research-activity-source">
                      ({a.source}
                      {a.url ? ` · ${new URL(a.url).hostname}` : ''})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {researchProfile.sourcesUnavailable.length > 0 && (
            <p className="research-unavailable">
              Unavailable sources: {researchProfile.sourcesUnavailable.join(', ')}
            </p>
          )}
        </section>
      )}

      <section className="lead-info-section">
        <h3>Actions</h3>
        <div className="lead-actions">
          <div className="status-change-form">
            <label htmlFor="new-status">Change Status:</label>
            <select
              id="new-status"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as CRMStatus | '')}
            >
              <option value="">Select status</option>
              {CRM_STATUSES.filter((s) => s !== lead.crmStatus).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {newStatus &&
              CRM_STATUSES.indexOf(newStatus as CRMStatus) <
                CRM_STATUSES.indexOf(lead.crmStatus) && (
                <input
                  type="text"
                  placeholder="Reason for backward move (required)"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  aria-label="Reason for status change"
                />
              )}
            {newStatus === 'Booked' && (
              <input
                type="datetime-local"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                aria-label="Meeting date and time"
              />
            )}
            <button
              type="button"
              onClick={handleStatusChange}
              disabled={!newStatus || changingStatus}
            >
              {changingStatus ? 'Updating...' : 'Update Status'}
            </button>
            {statusError && (
              <span className="field-error" role="alert">
                {statusError}
              </span>
            )}
          </div>

          <div className="action-links">
            <button
              type="button"
              className="action-btn"
              disabled={generatingMessage}
              onClick={async () => {
                if (!lead) return;
                setGeneratingMessage(true);
                setGeneratedMessage(null);
                setMessageError(null);
                try {
                  const res = await fetch('/api/messages/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      leadId: lead.id,
                      messageType: 'cold_email',
                      tone: 'professional',
                      productContext: 'Our product helps companies grow faster.',
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setMessageError(data.message ?? 'Failed to generate message');
                  } else {
                    setGeneratedMessage(data.message);
                  }
                } catch {
                  setMessageError('Network error generating message');
                } finally {
                  setGeneratingMessage(false);
                }
              }}
            >
              {generatingMessage ? 'Generating...' : 'Generate Message'}
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => {
                /* placeholder for outreach recording */
              }}
            >
              Record Outreach
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => {
                /* placeholder for call note */
              }}
            >
              Add Call Note
            </button>
          </div>

          {messageError && (
            <div className="field-error" role="alert">
              {messageError}
            </div>
          )}
          {generatedMessage && (
            <div className="generated-message-box">
              <div className="generated-message-label">Generated Message</div>
              <p className="generated-message-text">{generatedMessage}</p>
            </div>
          )}
        </div>
      </section>

      <section className="lead-info-section">
        <h3>Outreach History</h3>
        {outreach.length === 0 ? (
          <p className="empty-state">No outreach recorded yet.</p>
        ) : (
          <ul className="outreach-list">
            {outreach.map((o) => (
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

      <section className="lead-info-section">
        <h3>Call Notes</h3>
        {callNotes.length === 0 ? (
          <p className="empty-state">No call notes yet.</p>
        ) : (
          <ul className="call-notes-list">
            {callNotes.map((note) => (
              <li key={note.id} className="call-note-item">
                <div className="call-note-header">
                  <span className="call-note-date">
                    {new Date(note.createdAt).toLocaleDateString()}
                  </span>
                  <span className={`sentiment-badge sentiment-${note.sentiment}`}>
                    {note.sentiment}
                    {note.sentimentInferred ? ' (inferred)' : ''}
                  </span>
                  {note.tagGenerationFailed && (
                    <span className="tag-failed-badge">Tags failed</span>
                  )}
                </div>
                <p className="call-note-text">{note.rawText}</p>
                {note.tags.length > 0 && (
                  <div className="call-note-tags">
                    {note.tags.map((tag) => (
                      <span key={tag.id} className={`tag tag-${tag.category}`}>
                        {tag.value}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
