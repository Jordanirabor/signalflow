'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  classifyOutreachError,
  formatGenericError,
  formatSuccessToast,
  formatThrottleError,
  isSendDisabled,
  shouldTransitionToContacted,
} from '@/lib/composeEmailUtils';
import type { ApiError, CRMStatus } from '@/types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface ComposeEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id: string;
    name: string;
    email?: string;
    crmStatus: CRMStatus;
  };
  prefillSubject?: string;
  prefillBody?: string;
  onSuccess?: () => void;
}

interface EmailStatus {
  connected: boolean;
  email?: string;
  provider?: string;
}

export default function ComposeEmailModal({
  open,
  onOpenChange,
  lead,
  prefillSubject,
  prefillBody,
  onSuccess,
}: ComposeEmailModalProps) {
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [subject, setSubject] = useState(prefillSubject ?? 'Introduction');
  const [body, setBody] = useState(prefillBody ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ type: string; message: string } | null>(null);

  const fetchEmailStatus = useCallback(async () => {
    setEmailStatus(null);
    try {
      const res = await fetch('/api/pipeline/email/status');
      if (res.ok) {
        const data = await res.json();
        setEmailStatus({ connected: !!data.connected, email: data.email, provider: data.provider });
      } else {
        setEmailStatus({ connected: false });
      }
    } catch {
      setEmailStatus({ connected: false });
    }
  }, []);

  // Fetch email status and reset form when modal opens
  useEffect(() => {
    if (open) {
      fetchEmailStatus();
      setSubject(prefillSubject ?? 'Introduction');
      setBody(prefillBody ?? '');
      setSending(false);
      setError(null);
    }
  }, [open, prefillSubject, prefillBody, fetchEmailStatus]);

  // Clear error when user edits Subject or Body
  function handleSubjectChange(value: string) {
    setSubject(value);
    if (error) setError(null);
  }

  function handleBodyChange(value: string) {
    setBody(value);
    if (error) setError(null);
  }

  const sendDisabled = isSendDisabled(emailStatus?.connected ?? false, !!lead.email, body, sending);

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          channel: 'email',
          messageContent: body,
        }),
      });

      if (!res.ok) {
        const errBody: ApiError = await res.json();
        const classification = classifyOutreachError(res.status, errBody);
        let message: string;
        switch (classification) {
          case 'EMAIL_NOT_CONNECTED':
            message = 'Email is not connected. Connect your email account in Autopilot settings.';
            break;
          case 'EMAIL_MISSING':
            message = 'This lead has no email address.';
            break;
          case 'THROTTLE_LIMIT': {
            const limit = Number(errBody.details?.limit) || 0;
            const used = Number(errBody.details?.used) || 0;
            message = formatThrottleError(limit, used);
            break;
          }
          default:
            message = formatGenericError(errBody.message);
        }
        setError({ type: classification, message });
        setSending(false);
        return;
      }

      // On success, transition status if applicable
      if (shouldTransitionToContacted(lead.crmStatus)) {
        try {
          await fetch(`/api/crm/${lead.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toStatus: 'Contacted' }),
          });
        } catch {
          // Status transition failure is non-blocking
        }
      }

      // Close modal, show toast, call onSuccess
      onOpenChange(false);
      toast.success(formatSuccessToast(lead.email ?? '', subject), { duration: 5000 });
      onSuccess?.();
    } catch {
      setError({ type: 'NETWORK', message: 'Network error. Please try again.' });
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Compose Email to {lead.name}</DialogTitle>
          <DialogDescription>
            Send an email to this lead via your connected email account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Email Status Banner */}
          {emailStatus === null ? (
            <Skeleton className="h-10 w-full" />
          ) : emailStatus.connected ? (
            <div className="flex items-center gap-2 rounded-md border bg-green-50 px-3 py-2 text-sm dark:bg-green-950">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span>
                Connected via {emailStatus.provider === 'smtp_imap' ? 'SMTP' : 'Gmail'}:{' '}
                {emailStatus.email}
              </span>
            </div>
          ) : (
            <Alert>
              <AlertTitle>Email not connected</AlertTitle>
              <AlertDescription>
                Connect a Gmail account or configure SMTP/IMAP to send emails.{' '}
                <Link href="/autopilot" className="underline font-medium">
                  Connect in Autopilot settings
                </Link>
              </AlertDescription>
            </Alert>
          )}

          {/* Error alert */}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Send Failed</AlertTitle>
              <AlertDescription>
                {error.message}
                {error.type === 'EMAIL_NOT_CONNECTED' && (
                  <>
                    {' '}
                    <Link href="/autopilot" className="underline font-medium">
                      Go to Autopilot settings
                    </Link>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* To field */}
          <div className="space-y-1">
            <label htmlFor="compose-to" className="text-sm font-medium">
              To
            </label>
            {lead.email ? (
              <Input id="compose-to" value={lead.email} readOnly className="bg-muted" />
            ) : (
              <Alert variant="destructive">
                <AlertDescription>This lead has no email address on file.</AlertDescription>
              </Alert>
            )}
          </div>

          {/* Subject field */}
          <div className="space-y-1">
            <label htmlFor="compose-subject" className="text-sm font-medium">
              Subject
            </label>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(e) => handleSubjectChange(e.target.value)}
              placeholder="Email subject"
            />
          </div>

          {/* Body field */}
          <div className="space-y-1">
            <label htmlFor="compose-body" className="text-sm font-medium">
              Body
            </label>
            <Textarea
              id="compose-body"
              value={body}
              onChange={(e) => handleBodyChange(e.target.value)}
              placeholder="Write your message..."
              rows={8}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sendDisabled}>
            {sending ? 'Sending...' : 'Send Email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
