'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { ApiError, CallNote } from '@/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Sentiment = 'positive' | 'neutral' | 'negative' | '';

interface InsightFormProps {
  leadId: string;
}

export default function InsightForm({ leadId }: InsightFormProps) {
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
    if (!leadId) return;
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
  }, [leadId]);

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
        founderId: FOUNDER_ID,
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

  return (
    <div className="insight-form-container">
      <form onSubmit={handleSubmit} className="insight-form" noValidate>
        <h3>Post-Call Insight Capture</h3>

        <div className="form-field">
          <label htmlFor="insight-raw-text">
            Call Notes <span aria-hidden="true">*</span>
          </label>
          <textarea
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
            <span id="insight-raw-text-error" className="field-error" role="alert">
              {rawTextError}
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="insight-pain-points">Pain Points</label>
          <input
            id="insight-pain-points"
            type="text"
            value={painPoints}
            onChange={(e) => setPainPoints(e.target.value)}
            placeholder="Comma-separated, e.g. slow onboarding, lack of integrations"
          />
        </div>

        <div className="form-field">
          <label htmlFor="insight-objections">Objections</label>
          <input
            id="insight-objections"
            type="text"
            value={objections}
            onChange={(e) => setObjections(e.target.value)}
            placeholder="Comma-separated, e.g. too expensive, not enough features"
          />
        </div>

        <div className="form-field">
          <label htmlFor="insight-feature-requests">Feature Requests</label>
          <input
            id="insight-feature-requests"
            type="text"
            value={featureRequests}
            onChange={(e) => setFeatureRequests(e.target.value)}
            placeholder="Comma-separated, e.g. Slack integration, mobile app"
          />
        </div>

        <div className="form-field">
          <label htmlFor="insight-next-steps">Next Steps</label>
          <input
            id="insight-next-steps"
            type="text"
            value={nextSteps}
            onChange={(e) => setNextSteps(e.target.value)}
            placeholder="e.g. Schedule follow-up demo next week"
          />
        </div>

        <div className="form-field">
          <label htmlFor="insight-sentiment">Sentiment</label>
          <select
            id="insight-sentiment"
            value={sentiment}
            onChange={(e) => setSentiment(e.target.value as Sentiment)}
          >
            <option value="">Auto-detect (LLM inferred)</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
          </select>
        </div>

        <button type="submit" className="action-btn" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Call Note'}
        </button>

        {formError && (
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

      {/* Call Notes List — reverse chronological (Req 7.3) */}
      <section className="lead-info-section call-notes-section" aria-label="Call Notes">
        <h3>Call Notes</h3>
        {notesLoading ? (
          <p className="empty-state">Loading call notes...</p>
        ) : callNotes.length === 0 ? (
          <p className="empty-state">No call notes yet.</p>
        ) : (
          <ul className="call-notes-list">
            {callNotes.map((note) => (
              <li key={note.id} className="call-note-item">
                <div className="call-note-header">
                  <span className="call-note-date">{formatDate(note.createdAt)}</span>
                  <span className={`sentiment-badge sentiment-${note.sentiment}`}>
                    {note.sentiment}
                    {note.sentimentInferred ? ' (inferred)' : ''}
                  </span>
                  {note.tagGenerationFailed && (
                    <span className="tag-failed-badge" role="status">
                      Tags failed — manual tagging needed
                    </span>
                  )}
                </div>
                <p className="call-note-text">{note.rawText}</p>
                {note.painPoints.length > 0 && (
                  <div className="call-note-field">
                    <strong>Pain Points:</strong> {note.painPoints.join(', ')}
                  </div>
                )}
                {note.objections.length > 0 && (
                  <div className="call-note-field">
                    <strong>Objections:</strong> {note.objections.join(', ')}
                  </div>
                )}
                {note.featureRequests.length > 0 && (
                  <div className="call-note-field">
                    <strong>Feature Requests:</strong> {note.featureRequests.join(', ')}
                  </div>
                )}
                {note.nextSteps && (
                  <div className="call-note-field">
                    <strong>Next Steps:</strong> {note.nextSteps}
                  </div>
                )}
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
