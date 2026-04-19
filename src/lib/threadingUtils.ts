/**
 * Pure utility functions for message threading and matching.
 *
 * All functions are pure (no side effects) and exported for testability.
 * These implement the 3-tier matching strategy: In-Reply-To → References → email fallback.
 */

/**
 * Represents a successful match of an incoming message to an outreach record.
 */
export type ThreadMatch = {
  outreachRecordId: string;
  leadId: string;
  matchMethod: 'in_reply_to' | 'references' | 'email_fallback';
};

/**
 * Matches an incoming message by its In-Reply-To header against known outreach Message-IDs.
 * Returns a ThreadMatch with matchMethod 'in_reply_to' if found, otherwise null.
 */
export function matchByInReplyTo(
  inReplyTo: string | null,
  knownMessageIds: Map<string, { outreachRecordId: string; leadId: string }>,
): ThreadMatch | null {
  if (inReplyTo === null) {
    return null;
  }
  const match = knownMessageIds.get(inReplyTo);
  if (!match) {
    return null;
  }
  return {
    outreachRecordId: match.outreachRecordId,
    leadId: match.leadId,
    matchMethod: 'in_reply_to',
  };
}

/**
 * Matches an incoming message by its References header against known outreach Message-IDs.
 * Iterates through references in order and returns the first match found
 * with matchMethod 'references'. Returns null if no reference matches.
 */
export function matchByReferences(
  references: string[],
  knownMessageIds: Map<string, { outreachRecordId: string; leadId: string }>,
): ThreadMatch | null {
  for (const ref of references) {
    const match = knownMessageIds.get(ref);
    if (match) {
      return {
        outreachRecordId: match.outreachRecordId,
        leadId: match.leadId,
        matchMethod: 'references',
      };
    }
  }
  return null;
}

/**
 * Matches an incoming message by the sender's email address against known lead emails.
 * Returns a ThreadMatch with matchMethod 'email_fallback' if found, otherwise null.
 */
export function matchByEmail(
  fromEmail: string,
  leadEmails: Map<string, { outreachRecordId: string; leadId: string }>,
): ThreadMatch | null {
  const match = leadEmails.get(fromEmail);
  if (!match) {
    return null;
  }
  return {
    outreachRecordId: match.outreachRecordId,
    leadId: match.leadId,
    matchMethod: 'email_fallback',
  };
}
