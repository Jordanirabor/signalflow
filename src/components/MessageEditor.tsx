'use client';

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
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'direct', label: 'Direct' },
];

const FOUNDER_ID = process.env.NEXT_PUBLIC_FOUNDER_ID ?? 'founder-1';

export default function MessageEditor({ leadId: initialLeadId }: { leadId: string }) {
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [leads, setLeads] = useState<Pick<Lead, 'id' | 'name' | 'company'>[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(!initialLeadId);
  const [messageType, setMessageType] = useState<MessageType>('cold_email');
  const [tone, setTone] = useState<TonePreference>('professional');
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
    if (initialLeadId) return;
    setLoadingLeads(true);
    try {
      const res = await fetch(`/api/leads?founderId=${FOUNDER_ID}`);
      if (res.ok) {
        const data: Lead[] = await res.json();
        setLeads(data.map((l) => ({ id: l.id, name: l.name, company: l.company })));
      }
    } catch {
      /* silent */
    } finally {
      setLoadingLeads(false);
    }
  }, [initialLeadId]);

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

  return (
    <div className="message-editor">
      <h3>Generate Outreach Message</h3>

      {!initialLeadId && (
        <div className="form-field">
          <label htmlFor="msg-lead">
            Select Lead <span aria-hidden="true">*</span>
          </label>
          {loadingLeads ? (
            <p>Loading leads...</p>
          ) : leads.length === 0 ? (
            <p className="empty-state">No leads found. Add leads first.</p>
          ) : (
            <select
              id="msg-lead"
              value={selectedLeadId}
              onChange={(e) => setSelectedLeadId(e.target.value)}
              aria-required="true"
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

      <div className="message-editor-controls">
        <div className="form-field">
          <label htmlFor="msg-type">Message Type</label>
          <select
            id="msg-type"
            value={messageType}
            onChange={(e) => setMessageType(e.target.value as MessageType)}
          >
            {MESSAGE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="msg-tone">Tone</label>
          <select
            id="msg-tone"
            value={tone}
            onChange={(e) => setTone(e.target.value as TonePreference)}
          >
            {TONE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="msg-product-context">
          Product Context <span aria-hidden="true">*</span>
        </label>
        <textarea
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
          <span id="msg-product-context-error" className="field-error" role="alert">
            {contextError}
          </span>
        )}
      </div>

      <button
        type="button"
        className="action-btn"
        onClick={handleGenerate}
        disabled={generating || !effectiveLeadId}
      >
        {generating ? 'Generating...' : 'Generate Message'}
      </button>

      {error && (
        <div className="form-feedback error" role="alert">
          {error}
        </div>
      )}

      {limitedPersonalization && (
        <span className="limited-personalization-badge" role="status">
          Limited Personalization
        </span>
      )}

      {personalizationDetails.length > 0 && (
        <div className="personalization-details">
          <h4>Personalization Details</h4>
          <ul>
            {personalizationDetails.map((detail, i) => (
              <li key={i}>{detail}</li>
            ))}
          </ul>
        </div>
      )}

      {personalizationMeta && (
        <div className="personalization-insights">
          <div className="personalization-insights-title">Personalization Insights</div>
          <div className="personalization-insights-grid">
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
        </div>
      )}

      <div className="form-field">
        <label htmlFor="msg-output">Message</label>
        <textarea
          id="msg-output"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            error ? 'Write your message manually here...' : 'Generated message will appear here...'
          }
          rows={8}
          aria-label="Generated message"
        />
      </div>
    </div>
  );
}
