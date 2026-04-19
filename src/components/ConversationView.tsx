'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
import type { ConversationMessage, ConversationThread } from '@/types';
import { useCallback, useEffect, useState } from 'react';

function classificationVariant(
  classification: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (classification) {
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
    default:
      return 'secondary';
  }
}

function formatClassification(classification: string): string {
  return classification.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ConversationView() {
  const { session, isLoading: sessionLoading } = useSession();
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ConversationThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/pipeline/conversations');
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to load conversations');
        return;
      }
      const data: ConversationThread[] = await res.json();
      setThreads(data);
    } catch {
      setError('Network error loading conversations');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  const selectThread = useCallback(async (leadId: string) => {
    setThreadLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/conversations/${leadId}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.message ?? 'Failed to load conversation');
        return;
      }
      const data: ConversationThread = await res.json();
      setSelectedThread(data);
    } catch {
      setError('Network error loading conversation thread');
    } finally {
      setThreadLoading(false);
    }
  }, []);

  function formatTimestamp(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="col-span-2 h-64" />
        </div>
      </div>
    );
  }

  if (error && !selectedThread && threads.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={fetchThreads}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Conversations</h2>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Thread List */}
        <Card aria-label="Conversation threads">
          <CardHeader>
            <CardTitle>Threads</CardTitle>
          </CardHeader>
          <CardContent>
            {threads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No conversations yet.</p>
            ) : (
              <ul className="space-y-1">
                {threads.map((thread) => (
                  <li key={thread.leadId}>
                    <Button
                      variant={selectedThread?.leadId === thread.leadId ? 'secondary' : 'ghost'}
                      className="w-full justify-start text-left h-auto py-2"
                      onClick={() => selectThread(thread.leadId)}
                    >
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="font-medium text-sm">{thread.leadName}</span>
                        <span className="text-xs text-muted-foreground">{thread.company}</span>
                        {thread.email && (
                          <span className="text-xs text-muted-foreground">{thread.email}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Thread Detail */}
        <Card className="md:col-span-2" aria-label="Conversation messages">
          <CardContent className="pt-6">
            {threadLoading ? (
              <div className="space-y-3" role="status" aria-live="polite">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            ) : selectedThread ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">{selectedThread.leadName}</h3>
                  <p className="text-sm text-muted-foreground">{selectedThread.company}</p>
                  {selectedThread.email && (
                    <p className="text-sm text-muted-foreground">📧 {selectedThread.email}</p>
                  )}
                </div>
                {selectedThread.messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages in this thread.</p>
                ) : (
                  <ol className="space-y-3" aria-label="Messages in chronological order">
                    {selectedThread.messages.map((msg: ConversationMessage) => (
                      <li
                        key={msg.id}
                        className={`rounded-lg border p-3 ${
                          msg.direction === 'outbound' ? 'ml-8 bg-muted/50' : 'mr-8'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={msg.direction === 'outbound' ? 'secondary' : 'outline'}>
                            {msg.direction === 'outbound' ? 'Sent' : 'Received'}
                          </Badge>
                          {msg.channel && (
                            <Badge variant="outline" className="text-xs">
                              {msg.channel === 'email' ? '✉ Email' : '💬 DM'}
                            </Badge>
                          )}
                          {msg.isFollowUp && (
                            <Badge variant="outline" className="text-xs">
                              Follow-up
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(msg.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm">{msg.content}</p>
                        {msg.direction === 'inbound' && msg.classification && (
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant={classificationVariant(msg.classification)}>
                              {formatClassification(msg.classification)}
                            </Badge>
                            {msg.confidence != null && (
                              <span className="text-xs text-muted-foreground">
                                {(msg.confidence * 100).toFixed(0)}% confidence
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a conversation to view messages.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
