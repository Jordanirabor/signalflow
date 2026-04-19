/**
 * Pure utility functions for SMTP email operations.
 *
 * All functions are pure (no side effects) except generateMessageId
 * which uses crypto.randomUUID() for unique ID generation.
 */

/**
 * Generates an RFC 2822 Message-ID in the format `<uuid@domain>`.
 * Uses crypto.randomUUID() for the local part and extracts the domain from fromEmail.
 */
export function generateMessageId(fromEmail: string): string {
  const uuid = crypto.randomUUID();
  const domain = fromEmail.split('@')[1] || 'localhost';
  return `<${uuid}@${domain}>`;
}

/**
 * Constructs In-Reply-To and References headers for follow-up emails.
 * inReplyTo is set to the originalMessageId, and references appends
 * the originalMessageId to any existing references.
 */
export function buildFollowUpHeaders(
  originalMessageId: string,
  existingReferences?: string[],
): { inReplyTo: string; references: string[] } {
  return {
    inReplyTo: originalMessageId,
    references: [...(existingReferences || []), originalMessageId],
  };
}

/**
 * Appends a signature to the email body with a separator.
 * Returns the body unchanged if the signature is empty.
 */
export function appendSignatureToBody(body: string, signature: string): string {
  if (!signature) {
    return body;
  }
  return `${body}\n\n--\n${signature}`;
}

/**
 * Wraps an SMTP error code and message into a structured object.
 */
export function structureSmtpError(
  code: string,
  message: string,
): { smtpErrorCode: string; smtpErrorMessage: string } {
  return {
    smtpErrorCode: code,
    smtpErrorMessage: message,
  };
}
