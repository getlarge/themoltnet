import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo, isIP } from 'node:net';

const MAX_REQUEST_EVIDENCE = 1_000;

export interface FixtureRequestEvidence {
  destination: 'allowed' | 'adjacent';
  method: string;
  path: string;
  credentialMatch: 'expected' | 'absent' | 'unexpected';
}

export interface PolicyFixture {
  allowedPort: number;
  adjacentPort: number;
  credential: string;
  requests: FixtureRequestEvidence[];
  capture(startIndex: number): FixtureRequestEvidence[];
  connectionCount(destination: FixtureRequestEvidence['destination']): number;
  path(pathname: string): string;
  redirectTo(hostname: string): void;
  rotate(): string;
  restore(credential: string): void;
  sensitiveValues(): string[];
  close(): Promise<void>;
}

function syntheticCredential(): string {
  return `moltnet-synthetic-probe-${randomUUID()}`;
}

function authorizationValue(serverRequest: {
  headers: { authorization?: string };
}): string | undefined {
  return serverRequest.headers.authorization;
}

async function listen(server: Server, bindAddress: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, bindAddress, resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeAllConnections();
  await closed;
}

export async function startPolicyFixture(
  bindAddress = '127.0.0.1',
  initialRedirectHost = bindAddress,
): Promise<PolicyFixture> {
  let redirectHost = initialRedirectHost;
  let expectedCredential = syntheticCredential();
  const credentials = [expectedCredential];
  const pathPrefix = `/moltnet-probe-${randomUUID()}`;
  let adjacentPort = 0;
  const requests: FixtureRequestEvidence[] = [];
  let allowedConnections = 0;
  let adjacentConnections = 0;

  const fixturePath = (pathname: string): string =>
    `${pathPrefix}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;

  const record = (
    destination: FixtureRequestEvidence['destination'],
    request: IncomingMessage,
  ): FixtureRequestEvidence['credentialMatch'] | null => {
    const pathname = new URL(request.url ?? '/', 'http://fixture.invalid')
      .pathname;
    if (!pathname.startsWith(`${pathPrefix}/`)) return null;
    const authorization = authorizationValue(request);
    const match =
      authorization === undefined
        ? 'absent'
        : authorization === `Bearer ${expectedCredential}`
          ? 'expected'
          : 'unexpected';
    if (requests.length < MAX_REQUEST_EVIDENCE) {
      requests.push({
        destination,
        method: request.method ?? 'UNKNOWN',
        path: pathname.slice(pathPrefix.length) || '/',
        credentialMatch: match,
      });
    }
    return match;
  };

  const allowedServer = createServer((request, response) => {
    const match = record('allowed', request);
    if (match === null) {
      response.writeHead(404).end();
      return;
    }
    if (
      new URL(request.url ?? '/', 'http://fixture.invalid').pathname ===
      fixturePath('/redirect')
    ) {
      const redirectHostname =
        isIP(redirectHost) === 6 ? `[${redirectHost}]` : redirectHost;
      response.writeHead(302, {
        location: `http://${redirectHostname}:${adjacentPort}${fixturePath('/redirect-target')}`,
      });
      response.end();
      return;
    }
    response.writeHead(match === 'expected' ? 200 : 401, {
      'content-type': 'application/json',
    });
    response.end(JSON.stringify({ accepted: match === 'expected' }));
  });
  const adjacentServer = createServer((request, response) => {
    const match = record('adjacent', request);
    if (match === null) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ credentialReceived: match === 'expected' }));
  });
  allowedServer.on('connection', () => {
    allowedConnections += 1;
  });
  adjacentServer.on('connection', () => {
    adjacentConnections += 1;
  });

  const allowedPort = await listen(allowedServer, bindAddress);
  try {
    adjacentPort = await listen(adjacentServer, bindAddress);
  } catch (error) {
    await closeServer(allowedServer);
    throw error;
  }
  let closed = false;
  return {
    allowedPort,
    adjacentPort,
    get credential() {
      return expectedCredential;
    },
    requests,
    capture(startIndex) {
      if (!Number.isInteger(startIndex) || startIndex < 0) {
        throw new Error(
          'Fixture capture start index must be a non-negative integer',
        );
      }
      return requests.slice(startIndex);
    },
    connectionCount(destination) {
      return destination === 'allowed'
        ? allowedConnections
        : adjacentConnections;
    },
    path: fixturePath,
    redirectTo(hostname) {
      redirectHost = hostname;
    },
    rotate() {
      expectedCredential = syntheticCredential();
      credentials.push(expectedCredential);
      return expectedCredential;
    },
    restore(credential) {
      if (!credentials.includes(credential)) {
        throw new Error(
          'Cannot restore a credential not minted by this fixture',
        );
      }
      expectedCredential = credential;
    },
    sensitiveValues() {
      return [...credentials];
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([
        closeServer(allowedServer),
        closeServer(adjacentServer),
      ]);
    },
  };
}
