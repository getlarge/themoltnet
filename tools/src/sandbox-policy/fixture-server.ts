import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureRequestEvidence {
  destination: 'allowed' | 'adjacent';
  method: string;
  path: string;
  credentialMatch: 'expected' | 'absent' | 'unexpected';
}

export interface PolicyFixture {
  allowedPort: number;
  adjacentPort: number;
  requests: FixtureRequestEvidence[];
  rotate(value: string): void;
  close(): Promise<void>;
}

function authorizationValue(serverRequest: {
  headers: { authorization?: string };
}): string | undefined {
  return serverRequest.headers.authorization;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startPolicyFixture(
  initialCredential: string,
): Promise<PolicyFixture> {
  let expectedCredential = initialCredential;
  let adjacentPort = 0;
  const requests: FixtureRequestEvidence[] = [];

  const record = (
    destination: FixtureRequestEvidence['destination'],
    request: IncomingMessage,
  ): FixtureRequestEvidence['credentialMatch'] => {
    const authorization = authorizationValue(request);
    const match =
      authorization === undefined
        ? 'absent'
        : authorization === `Bearer ${expectedCredential}`
          ? 'expected'
          : 'unexpected';
    requests.push({
      destination,
      method: request.method ?? 'UNKNOWN',
      path: request.url ?? '/',
      credentialMatch: match,
    });
    return match;
  };

  const allowedServer = createServer((request, response) => {
    const match = record('allowed', request);
    if (request.url === '/redirect') {
      response.writeHead(302, {
        location: `http://127.0.0.1:${adjacentPort}/redirect-target`,
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
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ credentialReceived: match === 'expected' }));
  });

  const allowedPort = await listen(allowedServer);
  adjacentPort = await listen(adjacentServer);
  let closed = false;
  return {
    allowedPort,
    adjacentPort,
    requests,
    rotate(value: string) {
      expectedCredential = value;
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
