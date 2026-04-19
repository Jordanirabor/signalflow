import { describe, expect, it } from 'vitest';
import { matchByEmail, matchByInReplyTo, matchByReferences } from '../lib/threadingUtils';

describe('matchByInReplyTo', () => {
  const knownIds = new Map([
    ['<msg-1@example.com>', { outreachRecordId: 'or-1', leadId: 'lead-1' }],
    ['<msg-2@example.com>', { outreachRecordId: 'or-2', leadId: 'lead-2' }],
  ]);

  it('returns a match with method in_reply_to when inReplyTo exists in knownMessageIds', () => {
    const result = matchByInReplyTo('<msg-1@example.com>', knownIds);
    expect(result).toEqual({
      outreachRecordId: 'or-1',
      leadId: 'lead-1',
      matchMethod: 'in_reply_to',
    });
  });

  it('returns null when inReplyTo is null', () => {
    expect(matchByInReplyTo(null, knownIds)).toBeNull();
  });

  it('returns null when inReplyTo is not in knownMessageIds', () => {
    expect(matchByInReplyTo('<unknown@example.com>', knownIds)).toBeNull();
  });

  it('returns null when knownMessageIds is empty', () => {
    expect(matchByInReplyTo('<msg-1@example.com>', new Map())).toBeNull();
  });
});

describe('matchByReferences', () => {
  const knownIds = new Map([
    ['<msg-1@example.com>', { outreachRecordId: 'or-1', leadId: 'lead-1' }],
    ['<msg-2@example.com>', { outreachRecordId: 'or-2', leadId: 'lead-2' }],
  ]);

  it('returns the first matching reference with method references', () => {
    const result = matchByReferences(
      ['<unknown@example.com>', '<msg-2@example.com>', '<msg-1@example.com>'],
      knownIds,
    );
    expect(result).toEqual({
      outreachRecordId: 'or-2',
      leadId: 'lead-2',
      matchMethod: 'references',
    });
  });

  it('returns null when no references match', () => {
    expect(matchByReferences(['<a@b.com>', '<c@d.com>'], knownIds)).toBeNull();
  });

  it('returns null for an empty references array', () => {
    expect(matchByReferences([], knownIds)).toBeNull();
  });

  it('returns null when knownMessageIds is empty', () => {
    expect(matchByReferences(['<msg-1@example.com>'], new Map())).toBeNull();
  });
});

describe('matchByEmail', () => {
  const leadEmails = new Map([
    ['alice@example.com', { outreachRecordId: 'or-1', leadId: 'lead-1' }],
    ['bob@example.com', { outreachRecordId: 'or-2', leadId: 'lead-2' }],
  ]);

  it('returns a match with method email_fallback when email exists in leadEmails', () => {
    const result = matchByEmail('bob@example.com', leadEmails);
    expect(result).toEqual({
      outreachRecordId: 'or-2',
      leadId: 'lead-2',
      matchMethod: 'email_fallback',
    });
  });

  it('returns null when email is not in leadEmails', () => {
    expect(matchByEmail('unknown@example.com', leadEmails)).toBeNull();
  });

  it('returns null when leadEmails is empty', () => {
    expect(matchByEmail('alice@example.com', new Map())).toBeNull();
  });
});
