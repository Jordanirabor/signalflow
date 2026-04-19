'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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

export default function MessagesPage() {
  const { session, isLoading: sessionLoading } = useSession();
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [leads, setLeads] = useState<Pick<Lead, 'id' | 'name' | 'company'>[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
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

  const fetchLeads = useCallback(async () => {
    if (!session) return;
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
  }, [session]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  async function handleGenerate() {
    setContextError(null);
    if (!selectedLeadId) {
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
          leadId: selectedLeadId,
          messageType,
          tone,
          productContext: productContext.trim(),
        }),
      });

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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compose Messages</h1>
        <p className="text-muted-foreground">Draft, generate, and preview outreach messages</p>
      </div>

      {!selectedLeadId && !message && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Select a lead to start composing a message</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Message Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <label htmlFor="msg-lead" className="text-sm font-medium">
                Lead
              </label>
              {loadingLeads ? (
                <Skeleton className="h-9" />
              ) : (
                <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
                  <SelectTrigger id="msg-lead" aria-label="Select a lead">
                    <SelectValue placeholder="Select a lead" />
                  </SelectTrigger>
                  <SelectContent>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name} ({l.company})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="msg-tone" className="text-sm font-medium">
                Tone
              </label>
              <Select value={tone} onValueChange={(v) => setTone(v as TonePreference)}>
                <SelectTrigger id="msg-tone" aria-label="Select tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="msg-type" className="text-sm font-medium">
                Type
              </label>
              <Select value={messageType} onValueChange={(v) => setMessageType(v as MessageType)}>
                <SelectTrigger id="msg-type" aria-label="Select message type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MESSAGE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleGenerate}
                disabled={generating || !selectedLeadId}
                className="w-full"
              >
                {generating ? 'Generating...' : 'Generate'}
              </Button>
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
              placeholder="Describe your offering and what problem it solves..."
              rows={2}
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

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Editable Message Area */}
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

      {/* Preview Panel — read-only formatted view */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
        </CardHeader>
        <CardContent>
          {message ? (
            <div
              className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm"
              aria-label="Message preview"
            >
              {message}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No message to preview yet. Generate or type a message above.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Personalization Details */}
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
    </div>
  );
}
