import {
  appendSignatureToBody,
  buildFollowUpHeaders,
  generateMessageId,
  structureSmtpError,
} from '@/lib/smtpUtils';
import { describe, expect, it } from 'vitest';

describe('generateMessageId', () => {
  it('returns a string in RFC 2822 Message-ID format <uuid@domain>', () => {
    const result = generateMessageId('user@example.com');
    expect(result).toMatch(/^<[0-9a-f-]+@example\.com>$/);
  });

  it('extracts domain from the email address', () => {
    const result = generateMessageId('alice@mycompany.io');
    expect(result).toContain('@mycompany.io>');
  });

  it('generates unique IDs on successive calls', () => {
    const id1 = generateMessageId('user@example.com');
    const id2 = generateMessageId('user@example.com');
    expect(id1).not.toBe(id2);
  });

  it('falls back to localhost when email has no domain', () => {
    const result = generateMessageId('nodomain');
    expect(result).toContain('@localhost>');
  });
});

describe('buildFollowUpHeaders', () => {
  it('sets inReplyTo to the original message ID', () => {
    const result = buildFollowUpHeaders('<abc@example.com>');
    expect(result.inReplyTo).toBe('<abc@example.com>');
  });

  it('includes the original message ID in references', () => {
    const result = buildFollowUpHeaders('<abc@example.com>');
    expect(result.references).toContain('<abc@example.com>');
  });

  it('appends original ID to existing references', () => {
    const existing = ['<first@example.com>', '<second@example.com>'];
    const result = buildFollowUpHeaders('<third@example.com>', existing);
    expect(result.references).toEqual([
      '<first@example.com>',
      '<second@example.com>',
      '<third@example.com>',
    ]);
  });

  it('handles undefined existingReferences', () => {
    const result = buildFollowUpHeaders('<msg@example.com>', undefined);
    expect(result.references).toEqual(['<msg@example.com>']);
  });
});

describe('appendSignatureToBody', () => {
  it('appends signature with separator when signature is non-empty', () => {
    const result = appendSignatureToBody('Hello there', 'Best regards');
    expect(result).toBe('Hello there\n\n--\nBest regards');
  });

  it('returns body unchanged when signature is empty', () => {
    const result = appendSignatureToBody('Hello there', '');
    expect(result).toBe('Hello there');
  });

  it('body content appears before the signature', () => {
    const result = appendSignatureToBody('Body text', 'Sig');
    expect(result.indexOf('Body text')).toBeLessThan(result.indexOf('Sig'));
  });
});

describe('structureSmtpError', () => {
  it('wraps code and message into structured fields', () => {
    const result = structureSmtpError('550', 'Mailbox not found');
    expect(result).toEqual({
      smtpErrorCode: '550',
      smtpErrorMessage: 'Mailbox not found',
    });
  });

  it('preserves the exact code and message values', () => {
    const result = structureSmtpError('421', 'Service not available');
    expect(result.smtpErrorCode).toBe('421');
    expect(result.smtpErrorMessage).toBe('Service not available');
  });
});
