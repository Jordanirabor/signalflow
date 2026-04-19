'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/useSession';
import type {
  ApiError,
  EnhancedMessageResponse,
  Lead,
  MessageType,
  PersonalizationMetadata,
  TonePreference,
} from '@/types';
import { useCallback, useEffect, useState } from 'react';

const MESSAGE_TYPES: { value: MessageType; label: string }[] = [
  { value: 'cold_email', label: 'Cold Email' },
  { value: 'cold_dm', label: 'Cold DM' },
];

const TONE_OPTIONS: { value: TonePreference; label: string }[] = [
  { value: 'warm', label: 'Warm' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'direct', label: 'Direct' },
  { value: 'bold', label: 'Bold' },
];

export default function MessageEditor({ leadId: initialLeadId }: { leadId: string }) {
  const { session, isLoading: sessionLoading } = useSession();
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [leads, setLeads] = useState<Pick<Lead, 'id' | 'name' | 'company'>[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(!initialLeadId);
  const [messageType, setMessageType] = useState<MessageType>('cold_email');
  const [tone, setTone] = useState<TonePreference>('warm');
  const [productContext, setProductContext] = useState('');
  const [message, setMessage] = useState('');
  const [personalizationDetails, setPersonalizationDetails] = useState<string[]>([]);
  const [limitedPersonalization, setLimitedPersonalization] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [personalizationMeta, setPersonalizationMeta] = useState<PersonalizationMetadata | null>(
    null,
  );

  // Fetch leads for the selector when no leadId is provided
  const fetchLeads = useCallback(async () => {
    if (initialLeadId || !session) return;
    setLoadingLeads(true);
    try {
      const res = await fetch('/api/leads');
      if (res.ok) {
        const data: Lead[] = await res.json();
        setLeads(data.map((l) => ({ id: l.id, name: l.name, company: l.company })));
      }
    } catch {
      /* silent */
    } finally {
      setLoadingLeads(false);
    }
  }, [initialLeadId, session]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Keep in sync if parent changes the prop
  useEffect(() => {
    if (initialLeadId) setSelectedLeadId(initialLeadId);
  }, [initialLeadId]);

  const effectiveLeadId = selectedLeadId || initialLeadId;

  async function handleGenerate() {
    setContextError(null);
    if (!effectiveLeadId) {
      setError('Please select a lead first');
      return;
    }
    if (!productContext.trim()) {
      setContextError('Product context is required');
      return;
    }

    setGenerating(true);
    setError(null);
    setPersonalizationDetails([]);
    setLimitedPersonalization(false);
    setPersonalizationMeta(null);

    try {
      const res = await fetch('/api/messages/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: effectiveLeadId,
          messageType,
          tone,
          productContext: productContext.trim(),
        }),
      });

      if (res.status === 503) {
        const err: ApiError = await res.json();
        setError(err.message);
        return;
      }

      if (!res.ok) {
        const err: ApiError = await res.json();
        setError(err.message);
        return;
      }

      const data: EnhancedMessageResponse = await res.json();
      setMessage(data.message);
      setPersonalizationDetails(data.personalizationDetails);
      setLimitedPersonalization(data.limitedPersonalization);
      if (data.personalizationMetadata) setPersonalizationMeta(data.personalizationMetadata);
    } catch {
      setError('Network error. Please try again or write your message manually.');
    } finally {
      setGenerating(false);
    }
  }

  if (sessionLoading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Generate Outreach Message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!initialLeadId && (
            <div className="space-y-2">
              <label htmlFor="msg-lead" className="text-sm font-medium">
                Select Lead <span aria-hidden="true">*</span>
              </label>
              {loadingLeads ? (
                <Skeleton className="h-9" />
              ) : leads.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leads found. Add leads first.</p>
              ) : (
                <select
                  id="msg-lead"
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  aria-required="true"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">— Choose a lead —</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.company})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="msg-type" className="text-sm font-medium">
                Message Type
              </label>
              <select
                id="msg-type"
                value={messageType}
                onChange={(e) => setMessageType(e.target.value as MessageType)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {MESSAGE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="msg-tone" className="text-sm font-medium">
                Tone
              </label>
              <select
                id="msg-tone"
                value={tone}
                onChange={(e) => setTone(e.target.value as TonePreference)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TONE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="msg-product-context" className="text-sm font-medium">
              Product Context <span aria-hidden="true">*</span>
            </label>
            <Textarea
              id="msg-product-context"
              value={productContext}
              onChange={(e) => {
                setProductContext(e.target.value);
                if (contextError) setContextError(null);
              }}
              placeholder="Describe your product and what problem it solves..."
              rows={3}
              aria-required="true"
              aria-invalid={!!contextError}
              aria-describedby={contextError ? 'msg-product-context-error' : undefined}
            />
            {contextError && (
              <p id="msg-product-context-error" className="text-sm text-destructive" role="alert">
                {contextError}
              </p>
            )}
          </div>

          <Button onClick={handleGenerate} disabled={generating || !effectiveLeadId}>
            {generating ? 'Generating...' : 'Generate Message'}
          </Button>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {limitedPersonalization && (
        <Badge variant="secondary" role="status">
          Limited Personalization
        </Badge>
      )}

      {personalizationDetails.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personalization Details</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {personalizationDetails.map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {personalizationMeta && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personalization Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <span>
                Relevance score: {(personalizationMeta.intersectionScore * 100).toFixed(0)}%
              </span>
              {personalizationMeta.sourcesUsed.length > 0 && (
                <span>Sources: {personalizationMeta.sourcesUsed.join(', ')}</span>
              )}
              {personalizationMeta.painPointsReferenced.length > 0 && (
                <span>Pain points: {personalizationMeta.painPointsReferenced.join(', ')}</span>
              )}
              {personalizationMeta.contentReferenced.length > 0 && (
                <span>Content referenced: {personalizationMeta.contentReferenced.join(', ')}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Message</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            id="msg-output"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              error
                ? 'Write your message manually here...'
                : 'Generated message will appear here...'
            }
            rows={8}
            aria-label="Generated message"
          />
        </CardContent>
      </Card>
    </div>
  );
}
