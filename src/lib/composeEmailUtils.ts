import type { ApiError, CRMStatus } from '@/types';

/**
 * Error classification for outreach API responses.
 */
export type ErrorClassification =
  | 'EMAIL_NOT_CONNECTED'
  | 'EMAIL_MISSING'
  | 'THROTTLE_LIMIT'
  | 'GENERIC_ERROR';

/**
 * Returns `true` when the send button should be disabled.
 * The button is disabled when any prerequisite fails:
 * - Gmail is not connected
 * - Recipient email is missing
 * - Body content is empty or whitespace-only
 * - A send is currently in progress
 */
export function isSendDisabled(
  gmailConnected: boolean,
  hasRecipientEmail: boolean,
  bodyContent: string,
  isSending: boolean,
): boolean {
  return !gmailConnected || !hasRecipientEmail || !bodyContent.trim() || isSending;
}

/**
 * Returns `true` when the lead's CRM status should transition to "Contacted".
 * Only transitions from "New".
 */
export function shouldTransitionToContacted(currentStatus: CRMStatus): boolean {
  return currentStatus === 'New';
}

/**
 * Formats the success toast message after an email is sent.
 */
export function formatSuccessToast(recipientEmail: string, subject: string): string {
  return `Email sent to ${recipientEmail} — Subject: ${subject}`;
}

/**
 * Formats the throttle error message when the daily limit is reached.
 */
export function formatThrottleError(limit: number, used: number): string {
  return `Daily email limit reached (${limit}). Try again tomorrow.`;
}

/**
 * Formats a generic error message, wrapping the API message for display.
 */
export function formatGenericError(apiMessage: string): string {
  return apiMessage;
}

/**
 * Classifies an outreach API error response into an ErrorClassification.
 *
 * - HTTP 429 → THROTTLE_LIMIT
 * - body.details?.email === 'not_connected' → EMAIL_NOT_CONNECTED
 * - body.details?.email === 'missing' → EMAIL_MISSING
 * - anything else → GENERIC_ERROR
 */
export function classifyOutreachError(status: number, body: ApiError): ErrorClassification {
  if (status === 429) return 'THROTTLE_LIMIT';
  if (body.details?.email === 'not_connected') return 'EMAIL_NOT_CONNECTED';
  if (body.details?.email === 'missing') return 'EMAIL_MISSING';
  return 'GENERIC_ERROR';
}
