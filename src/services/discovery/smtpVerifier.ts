// ============================================================
// SMTP Verifier — RCPT TO handshake for email verification
// ============================================================

import net from 'net';

import type { SMTPVerificationResult } from './types';

const SMTP_PORT = 25;
const CONNECTION_TIMEOUT_MS = 10_000; // 10 seconds
const HELO_DOMAIN = 'verify.example.com';
const MAIL_FROM = 'verify@example.com';
const CATCH_ALL_LOCAL = 'randomstring12345';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses the 3-digit SMTP response code from a response line.
 * Returns -1 if the response cannot be parsed.
 */
function parseResponseCode(response: string): number {
  const code = parseInt(response.substring(0, 3), 10);
  return Number.isNaN(code) ? -1 : code;
}

/**
 * Creates a TCP connection to the given host on port 25 with a timeout.
 * Returns a promise that resolves with the socket once the greeting is received.
 */
function createSMTPConnection(host: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new Error(`Connection to ${host}:${SMTP_PORT} timed out after ${CONNECTION_TIMEOUT_MS}ms`),
      );
    }, CONNECTION_TIMEOUT_MS);

    socket.connect(SMTP_PORT, host, () => {
      // Wait for the server greeting (220)
    });

    let greeted = false;

    socket.on('data', (data) => {
      if (!greeted) {
        const code = parseResponseCode(data.toString());
        if (code === 220) {
          greeted = true;
          clearTimeout(timer);
          resolve(socket);
        } else {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`Unexpected greeting from ${host}: ${data.toString().trim()}`));
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.on('close', () => {
      if (!greeted) {
        clearTimeout(timer);
        reject(new Error(`Connection to ${host} closed before greeting`));
      }
    });
  });
}

/**
 * Sends an SMTP command and waits for the response.
 * Returns the full response string.
 */
function sendCommand(socket: net.Socket, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SMTP command timed out: ${command.trim()}`));
    }, CONNECTION_TIMEOUT_MS);

    socket.once('data', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });

    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.write(command + '\r\n');
  });
}

/**
 * Sends QUIT and destroys the socket. Best-effort — errors are swallowed.
 */
async function gracefulQuit(socket: net.Socket): Promise<void> {
  try {
    await sendCommand(socket, 'QUIT');
  } catch {
    // Swallow — we're closing anyway
  } finally {
    socket.destroy();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Performs an SMTP RCPT TO handshake to verify whether a mailbox exists.
 *
 * Handshake sequence:
 *   1. Connect → wait for 220 greeting
 *   2. HELO verify.example.com → expect 250
 *   3. MAIL FROM:<verify@example.com> → expect 250
 *   4. RCPT TO:<email> → 250 = valid, 550 = invalid
 *   5. QUIT
 *
 * Connection timeout: 10 seconds.
 */
export async function verifyEmail(email: string, mxHost: string): Promise<SMTPVerificationResult> {
  let socket: net.Socket | null = null;

  try {
    socket = await createSMTPConnection(mxHost);

    // HELO
    const heloResp = await sendCommand(socket, `HELO ${HELO_DOMAIN}`);
    const heloCode = parseResponseCode(heloResp);
    if (heloCode !== 250) {
      console.warn(`[smtpVerifier] HELO rejected by ${mxHost}: ${heloResp.trim()}`);
      await gracefulQuit(socket);
      return {
        email,
        valid: false,
        responseCode: heloCode,
        isCatchAll: false,
        confidence: 'low',
      };
    }

    // MAIL FROM
    const mailFromResp = await sendCommand(socket, `MAIL FROM:<${MAIL_FROM}>`);
    const mailFromCode = parseResponseCode(mailFromResp);
    if (mailFromCode !== 250) {
      console.warn(`[smtpVerifier] MAIL FROM rejected by ${mxHost}: ${mailFromResp.trim()}`);
      await gracefulQuit(socket);
      return {
        email,
        valid: false,
        responseCode: mailFromCode,
        isCatchAll: false,
        confidence: 'low',
      };
    }

    // RCPT TO
    const rcptResp = await sendCommand(socket, `RCPT TO:<${email}>`);
    const rcptCode = parseResponseCode(rcptResp);

    await gracefulQuit(socket);
    socket = null;

    const valid = rcptCode === 250;

    return {
      email,
      valid,
      responseCode: rcptCode,
      isCatchAll: false, // caller sets this based on detectCatchAll
      confidence: valid ? 'high' : 'low',
    };
  } catch (err) {
    console.error(
      `[smtpVerifier] Failed to verify ${email} via ${mxHost}:`,
      err instanceof Error ? err.message : err,
    );

    if (socket) {
      socket.destroy();
    }

    return {
      email,
      valid: false,
      responseCode: -1,
      isCatchAll: false,
      confidence: 'low',
    };
  }
}

/**
 * Detects whether a domain is a catch-all (accepts mail for any address).
 *
 * Sends RCPT TO for `randomstring12345@{domain}` — if the server responds
 * with 250, the domain is catch-all. Catch-all domains get "medium"
 * confidence instead of "high".
 */
export async function detectCatchAll(mxHost: string, domain: string): Promise<boolean> {
  const probeEmail = `${CATCH_ALL_LOCAL}@${domain}`;

  try {
    const result = await verifyEmail(probeEmail, mxHost);

    if (result.valid) {
      console.info(`[smtpVerifier] Catch-all detected for domain ${domain} via ${mxHost}`);
      return true;
    }

    return false;
  } catch (err) {
    console.warn(
      `[smtpVerifier] Catch-all detection failed for ${domain}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
