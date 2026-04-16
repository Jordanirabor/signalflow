'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { ManualReviewItem, ResponseClassification } from '@/types';
import { useCallback, useEffect, useState } from 'react';

const CLASSIFICATIONS: ResponseClassification[] = [
  'interested',
  'not_interested',
  'objection',
  'question',
  'out_of_office',
];

function classificationLabel(c: ResponseClassification): string {
  switch (c) {
    case 'interested':
      return 'Interested';
    case 'not_interested':
      return 'Not Interested';
    case 'objection':
      return 'Objection';
    case 'question':
      return 'Question';
    case 'out_of_office':
      return 'Out of Office';
  }
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.7) return 'confidence-high';
  if (confidence >= 0.4) return 'confidence-medium';
  return 'confidence-low';
}

export default function ManualReviewQueue() {
  const [items, setItems] = useState<ManualReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  const fetchReviewQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/review?founderId=${FOUNDER_ID}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to load review queue');
        return;
      }
      const data: ManualReviewItem[] = await res.json();
      setItems(data);
    } catch {
      setError('Network error loading review queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviewQueue();
  }, [fetchReviewQueue]);

  const resolveItem = useCallback(
    async (replyId: string, classification: ResponseClassification) => {
      setResolvingIds((prev) => new Set(prev).add(replyId));
      try {
        const res = await fetch(`/api/pipeline/review/${replyId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classification }),
        });
        if (!res.ok) {
          const err = await res.json();
          setError(err.message ?? 'Failed to resolve review item');
          return;
        }
        setItems((prev) => prev.filter((item) => item.replyId !== replyId));
      } catch {
        setError('Network error resolving review item');
      } finally {
        setResolvingIds((prev) => {
          const next = new Set(prev);
          next.delete(replyId);
          return next;
        });
      }
    },
    [],
  );

  if (loading) {
    return (
      <div className="review-queue-loading" role="status" aria-live="polite">
        Loading review queue...
      </div>
    );
  }

  if (error) {
    return (
      <div className="review-queue-error" role="alert">
        <p>{error}</p>
        <button type="button" className="action-btn" onClick={fetchReviewQueue}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="manual-review-queue">
      <h2>Manual Review Queue</h2>

      {items.length === 0 ? (
        <p className="empty-state">No items pending manual review.</p>
      ) : (
        <ul className="review-list" aria-label="Manual review items">
          {items.map((item) => {
            const isResolving = resolvingIds.has(item.replyId);
            return (
              <li key={item.replyId} className="review-item">
                <div className="review-item-header">
                  <span className="review-lead-name">{item.leadName}</span>
                  <span className="review-company">{item.company}</span>
                  <span className="review-date">
                    {new Date(item.receivedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <blockquote className="review-reply-text">{item.replyText}</blockquote>

                <div className="review-classification-info">
                  <span
                    className={`classification-badge classification-${item.suggestedClassification}`}
                  >
                    {classificationLabel(item.suggestedClassification)}
                  </span>
                  <span className={`confidence-score ${confidenceColor(item.confidence)}`}>
                    {(item.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>

                <div className="review-actions" role="group" aria-label="Classification actions">
                  <button
                    type="button"
                    className="action-btn action-confirm"
                    disabled={isResolving}
                    onClick={() => resolveItem(item.replyId, item.suggestedClassification)}
                  >
                    Confirm
                  </button>
                  {CLASSIFICATIONS.filter((c) => c !== item.suggestedClassification).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="action-btn action-override"
                      disabled={isResolving}
                      onClick={() => resolveItem(item.replyId, c)}
                    >
                      {classificationLabel(c)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
