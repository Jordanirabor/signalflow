'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
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

function classificationVariant(
  c: ResponseClassification,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (c) {
    case 'interested':
      return 'default';
    case 'not_interested':
      return 'destructive';
    case 'objection':
      return 'destructive';
    case 'question':
      return 'secondary';
    case 'out_of_office':
      return 'outline';
  }
}

function confidenceVariant(confidence: number): 'default' | 'secondary' | 'outline' {
  if (confidence >= 0.7) return 'default';
  if (confidence >= 0.4) return 'secondary';
  return 'outline';
}

export default function ManualReviewQueue() {
  const { session, isLoading: sessionLoading } = useSession();
  const [items, setItems] = useState<ManualReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  const fetchReviewQueue = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/pipeline/review');
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
  }, [session]);

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

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-56" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={fetchReviewQueue}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Manual Review Queue</h2>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">No items pending manual review.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4" aria-label="Manual review items">
          {items.map((item) => {
            const isResolving = resolvingIds.has(item.replyId);
            return (
              <li key={item.replyId}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-3">
                      <CardTitle className="text-base">{item.leadName}</CardTitle>
                      <span className="text-sm text-muted-foreground">{item.company}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.receivedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <blockquote className="border-l-2 pl-4 text-sm italic text-muted-foreground">
                      {item.replyText}
                    </blockquote>

                    <div className="flex items-center gap-2">
                      <Badge variant={classificationVariant(item.suggestedClassification)}>
                        {classificationLabel(item.suggestedClassification)}
                      </Badge>
                      <Badge variant={confidenceVariant(item.confidence)}>
                        {(item.confidence * 100).toFixed(0)}% confidence
                      </Badge>
                    </div>

                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label="Classification actions"
                    >
                      <Button
                        size="sm"
                        disabled={isResolving}
                        onClick={() => resolveItem(item.replyId, item.suggestedClassification)}
                      >
                        Confirm
                      </Button>
                      {CLASSIFICATIONS.filter((c) => c !== item.suggestedClassification).map(
                        (c) => (
                          <Button
                            key={c}
                            variant="outline"
                            size="sm"
                            disabled={isResolving}
                            onClick={() => resolveItem(item.replyId, c)}
                          >
                            {classificationLabel(c)}
                          </Button>
                        ),
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
