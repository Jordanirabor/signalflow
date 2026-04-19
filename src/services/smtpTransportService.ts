import { appendSignatureToBody, generateMessageId, structureSmtpError } from '@/lib/smtpUtils';
import { decrypt } from '@/services/emailIntegrationService';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  encryptedPassword: string;
  encryption: 'tls' | 'starttls' | 'none';
  fromEmail: string;
  fromName: string;
  replyToEmail?: string;
}

export interface SmtpSendOptions {
  config: SmtpConfig;
  to: string;
  subject: string;
  body: string;
  signature: string;
  inReplyTo?: string;
  references?: string[];
}

export interface SmtpSendResult {
  messageId: string;
  smtpResponse: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTransportOptions(config: SmtpConfig, password: string): SMTPTransport.Options {
  const base: SMTPTransport.Options = {
    host: config.host,
    port: config.port,
    auth: { user: config.username, pass: password },
  };

  switch (config.encryption) {
    case 'tls':
      return { ...base, secure: true };
    case 'starttls':
      return { ...base, secure: false, requireTLS: true };
    case 'none':
    default:
      return { ...base, secure: false, requireTLS: false };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sendViaSmtp(options: SmtpSendOptions): Promise<SmtpSendResult> {
  const { config, to, subject, body, signature, inReplyTo, references } = options;

  const password = decrypt(config.encryptedPassword);
  const transport = nodemailer.createTransport(buildTransportOptions(config, password));

  const messageId = generateMessageId(config.fromEmail);
  const fullBody = appendSignatureToBody(body, signature);

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${config.fromName}" <${config.fromEmail}>`,
    to,
    subject,
    text: fullBody,
    messageId,
    headers: {} as Record<string, string>,
  };

  if (config.replyToEmail) {
    mailOptions.replyTo = config.replyToEmail;
  }

  if (inReplyTo) {
    (mailOptions.headers as Record<string, string>)['In-Reply-To'] = inReplyTo;
  }

  if (references && references.length > 0) {
    (mailOptions.headers as Record<string, string>)['References'] = references.join(' ');
  }

  try {
    const info = await transport.sendMail(mailOptions);
    return {
      messageId,
      smtpResponse: info.response,
    };
  } catch (err: unknown) {
    const error = err as { responseCode?: number; code?: string; message?: string };
    const code = String(error.responseCode ?? error.code ?? 'UNKNOWN');
    const message = error.message ?? 'Unknown SMTP error';
    throw structureSmtpError(code, message);
  } finally {
    transport.close();
  }
}

export async function testSmtpConnection(
  config: SmtpConfig,
): Promise<{ success: boolean; error?: string }> {
  const password = decrypt(config.encryptedPassword);
  const transport = nodemailer.createTransport(buildTransportOptions(config, password));

  try {
    await transport.verify();
    return { success: true };
  } catch (err: unknown) {
    const error = err as { responseCode?: number; code?: string; message?: string };
    const code = String(error.responseCode ?? error.code ?? 'UNKNOWN');
    const message = error.message ?? 'Unknown SMTP error';
    const structured = structureSmtpError(code, message);
    return { success: false, error: `${structured.smtpErrorCode}: ${structured.smtpErrorMessage}` };
  } finally {
    transport.close();
  }
}
