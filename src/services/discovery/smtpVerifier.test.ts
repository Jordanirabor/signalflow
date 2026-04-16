import net from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectCatchAll, verifyEmail } from './smtpVerifier';

// ---------------------------------------------------------------------------
// Helpers — fake SMTP server
// ---------------------------------------------------------------------------

/**
 * Creates a minimal SMTP server that responds to the HELO/MAIL FROM/RCPT TO
 * handshake with configurable response codes.
 */
function createFakeSMTP(options: {
  rcptCode?: number;
  heloCode?: number;
  mailFromCode?: number;
  greetingCode?: number;
  /** If true, the server closes the connection before greeting */
  hangUp?: boolean;
  /** Delay in ms before sending the greeting */
  greetingDelay?: number;
}): net.Server {
  const {
    rcptCode = 250,
    heloCode = 250,
    mailFromCode = 250,
    greetingCode = 220,
    hangUp = false,
    greetingDelay = 0,
  } = options;

  const server = net.createServer((socket) => {
    if (hangUp) {
      socket.destroy();
      return;
    }

    const sendGreeting = () => {
      socket.write(`${greetingCode} fake-smtp ready\r\n`);
    };

    if (greetingDelay > 0) {
      setTimeout(sendGreeting, greetingDelay);
    } else {
      sendGreeting();
    }

    let step = 0; // 0=waiting HELO, 1=waiting MAIL FROM, 2=waiting RCPT TO

    socket.on('data', (data) => {
      const line = data.toString().trim().toUpperCase();

      if (line.startsWith('HELO') && step === 0) {
        socket.write(`${heloCode} Hello\r\n`);
        step = 1;
      } else if (line.startsWith('MAIL FROM') && step === 1) {
        socket.write(`${mailFromCode} OK\r\n`);
        step = 2;
      } else if (line.startsWith('RCPT TO') && step === 2) {
        socket.write(`${rcptCode} ${rcptCode === 250 ? 'OK' : 'User not found'}\r\n`);
        step = 3;
      } else if (line.startsWith('QUIT')) {
        socket.write('221 Bye\r\n');
        socket.end();
      } else {
        socket.write('500 Unrecognized command\r\n');
      }
    });
  });

  return server;
}

function listenOnRandomPort(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve(addr.port);
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

// We need to override the SMTP port used by verifyEmail. The module uses port 25
// by default, but our fake server listens on a random port. We'll monkey-patch
// net.Socket.prototype.connect to redirect connections to our fake server port.

let fakePort: number | null = null;
const originalConnect = net.Socket.prototype.connect;

function patchConnect() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (net.Socket.prototype as any).connect = function (portOrOptions: any, ...args: any[]) {
    if (typeof portOrOptions === 'number' && portOrOptions === 25 && fakePort !== null) {
      return originalConnect.call(this, fakePort, '127.0.0.1');
    }
    return originalConnect.call(this, portOrOptions, ...args);
  };
}

function restoreConnect() {
  net.Socket.prototype.connect = originalConnect;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyEmail', () => {
  let server: net.Server;

  beforeEach(() => {
    patchConnect();
  });

  afterEach(async () => {
    restoreConnect();
    fakePort = null;
    if (server) {
      await closeServer(server);
    }
  });

  it('returns valid=true with responseCode 250 for a valid mailbox', async () => {
    server = createFakeSMTP({ rcptCode: 250 });
    fakePort = await listenOnRandomPort(server);

    const result = await verifyEmail('john@acme.com', '127.0.0.1');

    expect(result.valid).toBe(true);
    expect(result.responseCode).toBe(250);
    expect(result.email).toBe('john@acme.com');
    expect(result.confidence).toBe('high');
  });

  it('returns valid=false with responseCode 550 for an invalid mailbox', async () => {
    server = createFakeSMTP({ rcptCode: 550 });
    fakePort = await listenOnRandomPort(server);

    const result = await verifyEmail('nobody@acme.com', '127.0.0.1');

    expect(result.valid).toBe(false);
    expect(result.responseCode).toBe(550);
    expect(result.confidence).toBe('low');
  });

  it('returns valid=false when HELO is rejected', async () => {
    server = createFakeSMTP({ heloCode: 550 });
    fakePort = await listenOnRandomPort(server);

    const result = await verifyEmail('john@acme.com', '127.0.0.1');

    expect(result.valid).toBe(false);
    expect(result.responseCode).toBe(550);
  });

  it('returns valid=false when MAIL FROM is rejected', async () => {
    server = createFakeSMTP({ mailFromCode: 550 });
    fakePort = await listenOnRandomPort(server);

    const result = await verifyEmail('john@acme.com', '127.0.0.1');

    expect(result.valid).toBe(false);
    expect(result.responseCode).toBe(550);
  });

  it('handles unreachable MX server gracefully', async () => {
    // Use localhost on a port that's not listening — gets immediate ECONNREFUSED
    // instead of a 10s timeout on a non-routable address
    const result = await verifyEmail('john@acme.com', '127.0.0.1');

    expect(result.valid).toBe(false);
    expect(result.responseCode).toBe(-1);
    expect(result.confidence).toBe('low');
  });

  it('sends graceful QUIT after verification', async () => {
    const quitReceived = vi.fn();
    server = net.createServer((socket) => {
      socket.write('220 ready\r\n');
      let step = 0;
      socket.on('data', (data) => {
        const line = data.toString().trim().toUpperCase();
        if (line.startsWith('HELO') && step === 0) {
          socket.write('250 Hello\r\n');
          step = 1;
        } else if (line.startsWith('MAIL FROM') && step === 1) {
          socket.write('250 OK\r\n');
          step = 2;
        } else if (line.startsWith('RCPT TO') && step === 2) {
          socket.write('250 OK\r\n');
          step = 3;
        } else if (line.startsWith('QUIT')) {
          quitReceived();
          socket.write('221 Bye\r\n');
          socket.end();
        }
      });
    });
    fakePort = await listenOnRandomPort(server);

    await verifyEmail('john@acme.com', '127.0.0.1');

    // Give a moment for the QUIT to be processed
    await new Promise((r) => setTimeout(r, 50));
    expect(quitReceived).toHaveBeenCalled();
  });

  it('handles server that closes connection before greeting', async () => {
    server = createFakeSMTP({ hangUp: true });
    fakePort = await listenOnRandomPort(server);

    const result = await verifyEmail('john@acme.com', '127.0.0.1');

    expect(result.valid).toBe(false);
    expect(result.responseCode).toBe(-1);
    expect(result.confidence).toBe('low');
  });
});

describe('detectCatchAll', () => {
  let server: net.Server;

  beforeEach(() => {
    patchConnect();
  });

  afterEach(async () => {
    restoreConnect();
    fakePort = null;
    if (server) {
      await closeServer(server);
    }
  });

  it('returns true when server accepts known-invalid address (catch-all)', async () => {
    server = createFakeSMTP({ rcptCode: 250 });
    fakePort = await listenOnRandomPort(server);

    const isCatchAll = await detectCatchAll('127.0.0.1', 'acme.com');

    expect(isCatchAll).toBe(true);
  });

  it('returns false when server rejects known-invalid address', async () => {
    server = createFakeSMTP({ rcptCode: 550 });
    fakePort = await listenOnRandomPort(server);

    const isCatchAll = await detectCatchAll('127.0.0.1', 'acme.com');

    expect(isCatchAll).toBe(false);
  });

  it('returns false when MX server is unreachable', async () => {
    // Use localhost — no server on port 25, gets immediate ECONNREFUSED
    const isCatchAll = await detectCatchAll('127.0.0.1', 'acme.com');

    expect(isCatchAll).toBe(false);
  });

  it('tests with randomstring12345@{domain}', async () => {
    let testedEmail = '';
    server = net.createServer((socket) => {
      socket.write('220 ready\r\n');
      let step = 0;
      socket.on('data', (data) => {
        const line = data.toString().trim();
        if (line.toUpperCase().startsWith('HELO') && step === 0) {
          socket.write('250 Hello\r\n');
          step = 1;
        } else if (line.toUpperCase().startsWith('MAIL FROM') && step === 1) {
          socket.write('250 OK\r\n');
          step = 2;
        } else if (line.toUpperCase().startsWith('RCPT TO') && step === 2) {
          // Capture the email being tested
          const match = line.match(/RCPT TO:<([^>]+)>/i);
          if (match) testedEmail = match[1];
          socket.write('550 User not found\r\n');
          step = 3;
        } else if (line.toUpperCase().startsWith('QUIT')) {
          socket.write('221 Bye\r\n');
          socket.end();
        }
      });
    });
    fakePort = await listenOnRandomPort(server);

    await detectCatchAll('127.0.0.1', 'example.com');

    expect(testedEmail).toBe('randomstring12345@example.com');
  });
});
