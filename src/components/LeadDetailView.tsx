'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
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
  const [newStatus, setNewStatus] = useState<CRMStatus | ''>('');
  const [statusReason, setStatusReason] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
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

  async function handleGenerateMessage() {
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
      if (!res.ok) setMessageError(data.message ?? 'Failed to generate message');
      else setGeneratedMessage(data.message);
    } catch {
      setMessageError('Network error generating message');
    } finally {
      setGeneratingMessage(false);
    }
  }

  async function handleRefreshResearch() {
    setRefreshingResearch(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/research/refresh`, { method: 'POST' });
      if (res.ok) setResearchProfile(await res.json());
    } catch {
      /* silent */
    } finally {
      setRefreshingResearch(false);
    }
  }

  const sourceLabels: Record<string, string> = {
    company_website_scrape: 'Company Website',
    twitter_scrape: 'Twitter/X',
    github_scrape: 'GitHub',
    linkedin_scrape: 'LinkedIn',
    news_scrape: 'News',
    premium_api: 'Premium Data',
  };
  const formatSource = (s: string) => sourceLabels[s] ?? s.replace(/_/g, ' ');

  if (loading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );

  if (error || !lead)
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Lead not found'}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={onBack}>
          Back to Leads
        </Button>
      </div>
    );

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack} className="gap-1">
        &larr; Back to Leads
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold tracking-tight">{lead.name}</h2>
        <Badge variant="outline">{lead.crmStatus}</Badge>
        <Badge
          variant={
            lead.enrichmentStatus === 'complete'
              ? 'default'
              : lead.enrichmentStatus === 'partial'
                ? 'secondary'
                : 'outline'
          }
        >
          {lead.enrichmentStatus === 'complete'
            ? 'Enriched'
            : lead.enrichmentStatus === 'partial'
              ? 'Partial'
              : lead.enrichmentStatus === 'researching'
                ? 'Researching'
                : 'Pending'}
        </Badge>
        {lead.enrichmentStatus === 'partial' &&
          lead.enrichmentData?.failedSources &&
          lead.enrichmentData.failedSources.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {lead.enrichmentData.failedSources.length} source
              {lead.enrichmentData.failedSources.length > 1 ? 's' : ''} unavailable (
              {lead.enrichmentData.failedSources.map(formatSource).join(', ')})
            </span>
          )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column — Details + Score + Enrichment */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <dt className="font-medium text-muted-foreground">Role</dt>
                <dd>{lead.role}</dd>
                <dt className="font-medium text-muted-foreground">Company</dt>
                <dd>{lead.company || '—'}</dd>
                <dt className="font-medium text-muted-foreground">Industry</dt>
                <dd>{lead.industry ?? '—'}</dd>
                <dt className="font-medium text-muted-foreground">Geography</dt>
                <dd>{lead.geography ?? '—'}</dd>
                {lead.email && (
                  <>
                    <dt className="font-medium text-muted-foreground">Email</dt>
                    <dd>{lead.email}</dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Score Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-4">
                <span className="text-3xl font-bold">{lead.leadScore}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-lg font-semibold">{lead.scoreBreakdown.icpMatch}</div>
                  <div className="text-muted-foreground">ICP Match</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-lg font-semibold">{lead.scoreBreakdown.roleRelevance}</div>
                  <div className="text-muted-foreground">Role Fit</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-lg font-semibold">{lead.scoreBreakdown.intentSignals}</div>
                  <div className="text-muted-foreground">Intent</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {lead.enrichmentData && (
            <Card>
              <CardHeader>
                <CardTitle>Enrichment Data</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {lead.enrichmentData.linkedinBio && (
                  <div>
                    <span className="font-medium text-muted-foreground">LinkedIn</span>
                    <p className="mt-1">{lead.enrichmentData.linkedinBio}</p>
                  </div>
                )}
                {lead.enrichmentData.companyInfo && (
                  <div>
                    <span className="font-medium text-muted-foreground">Company</span>
                    <p className="mt-1">{lead.enrichmentData.companyInfo}</p>
                  </div>
                )}
                {lead.enrichmentData.recentPosts && lead.enrichmentData.recentPosts.length > 0 && (
                  <div>
                    <span className="font-medium text-muted-foreground">Recent Posts</span>
                    <ul className="mt-1 ml-4 list-disc space-y-1">
                      {lead.enrichmentData.recentPosts.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {correlationData && (
            <Card>
              <CardHeader>
                <CardTitle>ICP Correlation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-bold">
                    {(correlationData.total * 100).toFixed(0)}%
                  </span>
                  {correlationData.flag && <Badge variant="destructive">Low correlation</Badge>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-lg font-semibold">
                      {(correlationData.breakdown.roleFit * 100).toFixed(0)}%
                    </div>
                    <div className="text-muted-foreground">Role Fit</div>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-lg font-semibold">
                      {(correlationData.breakdown.industryAlignment * 100).toFixed(0)}%
                    </div>
                    <div className="text-muted-foreground">Industry</div>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-lg font-semibold">
                      {(correlationData.breakdown.painPointOverlap * 100).toFixed(0)}%
                    </div>
                    <div className="text-muted-foreground">Pain Points</div>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-lg font-semibold">
                      {(correlationData.breakdown.buyingSignalStrength * 100).toFixed(0)}%
                    </div>
                    <div className="text-muted-foreground">Signals</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {researchProfile && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Research Profile</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshResearch}
                    disabled={refreshingResearch}
                  >
                    {refreshingResearch ? 'Refreshing...' : 'Refresh'}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Researched {new Date(researchProfile.researchedAt).toLocaleDateString()} ·{' '}
                  {researchProfile.overallSentiment} ·{' '}
                  {researchProfile.sourcesUsed.join(', ') || 'no sources'}
                </p>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {researchProfile.topicsOfInterest.length > 0 && (
                  <div>
                    <span className="font-medium text-muted-foreground">Topics of Interest</span>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {researchProfile.topicsOfInterest.map((t, i) => (
                        <Badge key={i} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {researchProfile.currentChallenges.length > 0 && (
                  <div>
                    <span className="font-medium text-muted-foreground">Current Challenges</span>
                    <ul className="mt-1 ml-4 list-disc space-y-1">
                      {researchProfile.currentChallenges.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {researchProfile.recentActivity.length > 0 && (
                  <div>
                    <span className="font-medium text-muted-foreground">Recent Activity</span>
                    <ul className="mt-1 ml-4 list-disc space-y-1">
                      {researchProfile.recentActivity.slice(0, 5).map((a, i) => (
                        <li key={i}>
                          {a.summary} <span className="text-muted-foreground">({a.source})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — Actions + History */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="new-status" className="text-sm font-medium">
                  Change Status
                </label>
                <select
                  id="new-status"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as CRMStatus | '')}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                    <Input
                      placeholder="Reason for backward move (required)"
                      value={statusReason}
                      onChange={(e) => setStatusReason(e.target.value)}
                    />
                  )}
                {newStatus === 'Booked' && (
                  <Input
                    type="datetime-local"
                    value={meetingDate}
                    onChange={(e) => setMeetingDate(e.target.value)}
                  />
                )}
                <Button
                  size="sm"
                  onClick={handleStatusChange}
                  disabled={!newStatus || changingStatus}
                  className="w-full"
                >
                  {changingStatus ? 'Updating...' : 'Update Status'}
                </Button>
                {statusError && (
                  <Alert variant="destructive">
                    <AlertDescription>{statusError}</AlertDescription>
                  </Alert>
                )}
              </div>
              <Separator />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleGenerateMessage}
                disabled={generatingMessage}
              >
                {generatingMessage ? 'Generating...' : 'Generate Message'}
              </Button>
              {messageError && (
                <Alert variant="destructive">
                  <AlertDescription>{messageError}</AlertDescription>
                </Alert>
              )}
              {generatedMessage && (
                <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                  <div className="mb-1 font-medium text-muted-foreground">Generated Message</div>
                  <p className="whitespace-pre-wrap">{generatedMessage}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Outreach History</CardTitle>
            </CardHeader>
            <CardContent>
              {outreach.length === 0 ? (
                <p className="text-sm text-muted-foreground">No outreach recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {outreach.map((o) => (
                    <div key={o.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {new Date(o.outreachDate).toLocaleDateString()}
                        </span>
                        <Badge variant="outline">{o.channel}</Badge>
                        {o.isFollowUp && <Badge variant="secondary">Follow-up</Badge>}
                      </div>
                      <p className="mt-1">{o.messageContent}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Call Notes</CardTitle>
            </CardHeader>
            <CardContent>
              {callNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No call notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {callNotes.map((note) => (
                    <div key={note.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {new Date(note.createdAt).toLocaleDateString()}
                        </span>
                        <Badge
                          variant={
                            note.sentiment === 'positive'
                              ? 'default'
                              : note.sentiment === 'negative'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {note.sentiment}
                          {note.sentimentInferred ? ' (inferred)' : ''}
                        </Badge>
                      </div>
                      <p className="mt-1">{note.rawText}</p>
                      {note.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {note.tags.map((tag) => (
                            <Badge key={tag.id} variant="outline">
                              {tag.value}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
