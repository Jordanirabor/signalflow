'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { ConversationMessage, ConversationThread } from '@/types';
import { useCallback, useEffect, useState } from 'react';

export default function ConversationView() {
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ConversationThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/conversations?founderId=${FOUNDER_ID}`);
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
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  const selectThread = useCallback(async (leadId: string) => {
    setThreadLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/conversations/${leadId}?founderId=${FOUNDER_ID}`);
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

  function classificationBadgeClass(classification: string): string {
    switch (classification) {
      case 'interested':
        return 'classification-badge-interested';
      case 'not_interested':
        return 'classification-badge-not-interested';
      case 'objection':
        return 'classification-badge-objection';
      case 'question':
        return 'classification-badge-question';
      case 'out_of_office':
        return 'classification-badge-ooo';
      default:
        return '';
    }
  }

  function formatClassification(classification: string): string {
    return classification.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  if (loading) {
    return (
      <div className="dashboard-loading" role="status" aria-live="polite">
        Loading conversations...
      </div>
    );
  }

  if (error && !selectedThread && threads.length === 0) {
    return (
      <div className="dashboard-error" role="alert">
        <p>{error}</p>
        <button type="button" className="action-btn" onClick={fetchThreads}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="conversation-view">
      <h2>Conversations</h2>

      {error && (
        <div className="conversation-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="conversation-layout">
        {/* Thread List */}
        <section className="conversation-thread-list" aria-label="Conversation threads">
          <h3>Threads</h3>
          {threads.length === 0 ? (
            <p className="empty-state">No conversations yet.</p>
          ) : (
            <ul className="thread-list">
              {threads.map((thread) => (
                <li key={thread.leadId}>
                  <button
                    type="button"
                    className={`thread-item ${selectedThread?.leadId === thread.leadId ? 'thread-item-active' : ''}`}
                    onClick={() => selectThread(thread.leadId)}
                  >
                    <span className="thread-lead-name">{thread.leadName}</span>
                    <span className="thread-company">{thread.company}</span>
                    <span className="thread-message-count">
                      {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Thread Detail */}
        <section className="conversation-thread-detail" aria-label="Conversation messages">
          {threadLoading ? (
            <div className="dashboard-loading" role="status" aria-live="polite">
              Loading thread...
            </div>
          ) : selectedThread ? (
            <>
              <div className="thread-header">
                <h3>{selectedThread.leadName}</h3>
                <span className="thread-header-company">{selectedThread.company}</span>
              </div>
              <div className="thread-messages">
                {selectedThread.messages.length === 0 ? (
                  <p className="empty-state">No messages in this thread.</p>
                ) : (
                  <ol className="message-list" aria-label="Messages in chronological order">
                    {selectedThread.messages.map((msg: ConversationMessage) => (
                      <li key={msg.id} className={`message-item message-${msg.direction}`}>
                        <div className="message-meta">
                          <span className="message-direction">
                            {msg.direction === 'outbound' ? 'Sent' : 'Received'}
                          </span>
                          <span className="message-timestamp">
                            {formatTimestamp(msg.timestamp)}
                          </span>
                        </div>
                        <div className="message-content">{msg.content}</div>
                        {msg.direction === 'inbound' && msg.classification && (
                          <div className="message-classification">
                            <span
                              className={`classification-badge ${classificationBadgeClass(msg.classification)}`}
                            >
                              {formatClassification(msg.classification)}
                            </span>
                            {msg.confidence != null && (
                              <span className="classification-confidence">
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
            </>
          ) : (
            <p className="empty-state">Select a conversation to view messages.</p>
          )}
        </section>
      </div>
    </div>
  );
}
