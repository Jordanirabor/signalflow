'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/useSession';
import type { ApiError, CallNote } from '@/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Sentiment = 'positive' | 'neutral' | 'negative' | '';

interface InsightFormProps {
  leadId: string;
}

export default function InsightForm({ leadId }: InsightFormProps) {
  const { session, isLoading: sessionLoading } = useSession();
  // Form state
  const [painPoints, setPainPoints] = useState('');
  const [objections, setObjections] = useState('');
  const [featureRequests, setFeatureRequests] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [sentiment, setSentiment] = useState<Sentiment>('');
  const [rawText, setRawText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [rawTextError, setRawTextError] = useState<string | null>(null);

  // Call notes list
  const [callNotes, setCallNotes] = useState<CallNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);

  const fetchCallNotes = useCallback(async () => {
    if (!leadId || !session) return;
    setNotesLoading(true);
    try {
      const res = await fetch(`/api/insights/${leadId}`);
      if (res.ok) {
        setCallNotes(await res.json());
      }
    } catch {
      /* silent */
    } finally {
      setNotesLoading(false);
    }
  }, [leadId, session]);

  useEffect(() => {
    fetchCallNotes();
  }, [fetchCallNotes]);

  function splitField(value: string): string[] {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setRawTextError(null);

    if (!rawText.trim()) {
      setRawTextError('Call notes text is required');
      return;
    }

    if (!leadId) {
      setFormError('Please select a lead first');
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        rawText: rawText.trim(),
      };

      const pp = splitField(painPoints);
      if (pp.length > 0) body.painPoints = pp;
      const obj = splitField(objections);
      if (obj.length > 0) body.objections = obj;
      const fr = splitField(featureRequests);
      if (fr.length > 0) body.featureRequests = fr;
      if (nextSteps.trim()) body.nextSteps = nextSteps.trim();
      if (sentiment) body.sentiment = sentiment;

      const res = await fetch(`/api/insights/${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err: ApiError = await res.json();
        setFormError(err.message);
        return;
      }

      const note: CallNote = await res.json();

      // Show appropriate success message
      if (note.tagGenerationFailed) {
        setFormSuccess(
          'Call note saved. Tag generation failed — you can manually tag this note later.',
        );
      } else {
        const tagCount = note.tags.length;
        setFormSuccess(
          `Call note saved successfully. ${tagCount} tag${tagCount !== 1 ? 's' : ''} generated.${note.sentimentInferred ? ' Sentiment was inferred automatically.' : ''}`,
        );
      }

      // Reset form
      setPainPoints('');
      setObjections('');
      setFeatureRequests('');
      setNextSteps('');
      setSentiment('');
      setRawText('');

      await fetchCallNotes();
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (sessionLoading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Post-Call Insight Capture</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <label htmlFor="insight-raw-text" className="text-sm font-medium">
                Call Notes <span aria-hidden="true">*</span>
              </label>
              <Textarea
                id="insight-raw-text"
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  if (rawTextError) setRawTextError(null);
                }}
                placeholder="Describe the conversation — key takeaways, what was discussed, outcomes..."
                rows={5}
                aria-required="true"
                aria-invalid={!!rawTextError}
                aria-describedby={rawTextError ? 'insight-raw-text-error' : undefined}
              />
              {rawTextError && (
                <p id="insight-raw-text-error" className="text-sm text-destructive" role="alert">
                  {rawTextError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="insight-pain-points" className="text-sm font-medium">
                Pain Points
              </label>
              <Input
                id="insight-pain-points"
                value={painPoints}
                onChange={(e) => setPainPoints(e.target.value)}
                placeholder="Comma-separated, e.g. slow onboarding, lack of integrations"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="insight-objections" className="text-sm font-medium">
                Objections
              </label>
              <Input
                id="insight-objections"
                value={objections}
                onChange={(e) => setObjections(e.target.value)}
                placeholder="Comma-separated, e.g. too expensive, not enough features"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="insight-feature-requests" className="text-sm font-medium">
                Feature Requests
              </label>
              <Input
                id="insight-feature-requests"
                value={featureRequests}
                onChange={(e) => setFeatureRequests(e.target.value)}
                placeholder="Comma-separated, e.g. Slack integration, mobile app"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="insight-next-steps" className="text-sm font-medium">
                Next Steps
              </label>
              <Input
                id="insight-next-steps"
                value={nextSteps}
                onChange={(e) => setNextSteps(e.target.value)}
                placeholder="e.g. Schedule follow-up demo next week"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="insight-sentiment" className="text-sm font-medium">
                Sentiment
              </label>
              <select
                id="insight-sentiment"
                value={sentiment}
                onChange={(e) => setSentiment(e.target.value as Sentiment)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Auto-detect (LLM inferred)</option>
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                <option value="negative">Negative</option>
              </select>
            </div>

            <Button type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Call Note'}
            </Button>

            {formError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            {formSuccess && (
              <Alert role="status">
                <AlertDescription>{formSuccess}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Call Notes List */}
      <Card>
        <CardHeader>
          <CardTitle>Call Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {notesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : callNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No call notes yet.</p>
          ) : (
            <ul className="space-y-4">
              {callNotes.map((note) => (
                <li key={note.id} className="rounded-lg border p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {formatDate(note.createdAt)}
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
                    {note.tagGenerationFailed && (
                      <Badge variant="destructive" role="status">
                        Tags failed — manual tagging needed
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm">{note.rawText}</p>
                  {note.painPoints.length > 0 && (
                    <div className="text-sm">
                      <span className="font-medium text-muted-foreground">Pain Points:</span>{' '}
                      {note.painPoints.join(', ')}
                    </div>
                  )}
                  {note.objections.length > 0 && (
                    <div className="text-sm">
                      <span className="font-medium text-muted-foreground">Objections:</span>{' '}
                      {note.objections.join(', ')}
                    </div>
                  )}
                  {note.featureRequests.length > 0 && (
                    <div className="text-sm">
                      <span className="font-medium text-muted-foreground">Feature Requests:</span>{' '}
                      {note.featureRequests.join(', ')}
                    </div>
                  )}
                  {note.nextSteps && (
                    <div className="text-sm">
                      <span className="font-medium text-muted-foreground">Next Steps:</span>{' '}
                      {note.nextSteps}
                    </div>
                  )}
                  {note.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {note.tags.map((tag) => (
                        <Badge key={tag.id} variant="outline">
                          {tag.value}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
