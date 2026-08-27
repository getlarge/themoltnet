import { createServer, type IncomingHttpHeaders, request } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type Duplex } from 'node:stream';

import type { PolicyFixture } from './fixture-server.js';

export const PROTECTED_FIXTURE_HOST = 'protected.credential.test';
export const ADJACENT_FIXTURE_HOST = 'adjacent.credential.test';

export type ExactOriginRoute =
  | 'protected'
  | 'wrong-host'
  | 'wrong-port'
  | 'adjacent'
  | 'network-allowed'
  | 'network-adjacent'
  | 'wrong-protocol'
  | 'unmapped';

export interface ExactOriginDecision {
  action: 'forward' | 'deny';
  credential: 'preserved' | 'removed' | 'absent';
  protocol: 'http' | 'https' | 'unknown';
  route: ExactOriginRoute;
}

export interface ExactOriginProxy {
  decisions: ExactOriginDecision[];
  url: string;
  close(): Promise<void>;
}

interface RouteTarget {
  fixturePort: number;
  preserveCredential: boolean;
  route: Exclude<ExactOriginRoute, 'wrong-protocol' | 'unmapped'>;
}

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const;

function canonicalPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

function routeKey(hostname: string, port: number): string {
  return `${hostname.toLowerCase()}:${port}`;
}

function forwardedHeaders(
  headers: IncomingHttpHeaders,
  preserveCredential: boolean,
): IncomingHttpHeaders {
  const forwarded = { ...headers };
  for (const header of HOP_BY_HOP_HEADERS) delete forwarded[header];
  if (!preserveCredential) delete forwarded.authorization;
  return forwarded;
}

export async function startExactOriginProxy(
  fixture: PolicyFixture,
  bindAddress = '127.0.0.1',
  networkFixtureHosts = ['localhost', 'host.docker.internal'],
): Promise<ExactOriginProxy> {
  const decisions: ExactOriginDecision[] = [];
  const routes = new Map<string, RouteTarget>([
    [
      routeKey(PROTECTED_FIXTURE_HOST, fixture.allowedPort),
      {
        fixturePort: fixture.allowedPort,
        preserveCredential: true,
        route: 'protected',
      },
    ],
    [
      routeKey(ADJACENT_FIXTURE_HOST, fixture.allowedPort),
      {
        fixturePort: fixture.allowedPort,
        preserveCredential: false,
        route: 'wrong-host',
      },
    ],
    [
      routeKey(PROTECTED_FIXTURE_HOST, fixture.adjacentPort),
      {
        fixturePort: fixture.adjacentPort,
        preserveCredential: false,
        route: 'wrong-port',
      },
    ],
    [
      routeKey(ADJACENT_FIXTURE_HOST, fixture.adjacentPort),
      {
        fixturePort: fixture.adjacentPort,
        preserveCredential: false,
        route: 'adjacent',
      },
    ],
  ]);
  for (const networkFixtureHost of networkFixtureHosts) {
    routes.set(routeKey(networkFixtureHost, fixture.allowedPort), {
      fixturePort: fixture.allowedPort,
      preserveCredential: false,
      route: 'network-allowed',
    });
    routes.set(routeKey(networkFixtureHost, fixture.adjacentPort), {
      fixturePort: fixture.adjacentPort,
      preserveCredential: false,
      route: 'network-adjacent',
    });
  }
  const tunneledSockets = new Set<Duplex>();
  const handleHttp = createServer((incoming, response) => {
    let destination: URL;
    try {
      const requestTarget = incoming.url ?? '';
      destination = /^https?:\/\//i.test(requestTarget)
        ? new URL(requestTarget)
        : new URL(requestTarget, `http://${incoming.headers.host ?? ''}`);
    } catch {
      decisions.push({
        action: 'deny',
        credential: incoming.headers.authorization ? 'removed' : 'absent',
        protocol: 'unknown',
        route: 'unmapped',
      });
      response.writeHead(403).end();
      return;
    }
    if (destination.protocol !== 'http:') {
      decisions.push({
        action: 'deny',
        credential: incoming.headers.authorization ? 'removed' : 'absent',
        protocol: destination.protocol === 'https:' ? 'https' : 'unknown',
        route: 'wrong-protocol',
      });
      response.writeHead(403).end();
      return;
    }
    const target = routes.get(
      routeKey(destination.hostname, canonicalPort(destination)),
    );
    if (!target) {
      decisions.push({
        action: 'deny',
        credential: incoming.headers.authorization ? 'removed' : 'absent',
        protocol: 'http',
        route: 'unmapped',
      });
      response.writeHead(403).end();
      return;
    }
    const preserveCredential = target.preserveCredential;
    decisions.push({
      action: 'forward',
      credential: incoming.headers.authorization
        ? preserveCredential
          ? 'preserved'
          : 'removed'
        : 'absent',
      protocol: 'http',
      route: target.route,
    });
    const upstream = request(
      {
        headers: forwardedHeaders(incoming.headers, preserveCredential),
        host: bindAddress,
        method: incoming.method,
        path: `${destination.pathname}${destination.search}`,
        port: target.fixturePort,
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    upstream.once('error', () => response.writeHead(502).end());
    incoming.pipe(upstream);
  });
  const server = createServer((incoming, response) => {
    handleHttp.emit('request', incoming, response);
  });
  server.on('connect', (incoming, socket, head) => {
    let authority: URL;
    try {
      authority = new URL(`http://${incoming.url ?? ''}`);
    } catch {
      decisions.push({
        action: 'deny',
        credential: 'absent',
        protocol: 'unknown',
        route: 'unmapped',
      });
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const target = routes.get(
      routeKey(authority.hostname, canonicalPort(authority)),
    );
    if (!target) {
      decisions.push({
        action: 'deny',
        credential: 'absent',
        protocol: 'unknown',
        route: 'unmapped',
      });
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    tunneledSockets.add(socket);
    socket.once('close', () => tunneledSockets.delete(socket));
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const inspectTunnel = (firstBytes: Buffer): void => {
      if (firstBytes[0] === 0x16) {
        decisions.push({
          action: 'deny',
          credential: 'absent',
          protocol: 'https',
          route: 'wrong-protocol',
        });
        socket.destroy();
        return;
      }
      if (!/^[A-Z]+\s/.test(firstBytes.toString('ascii', 0, 16))) {
        decisions.push({
          action: 'deny',
          credential: 'absent',
          protocol: 'unknown',
          route: 'unmapped',
        });
        socket.destroy();
        return;
      }
      socket.unshift(firstBytes);
      handleHttp.emit('connection', socket);
    };
    if (head.length > 0) inspectTunnel(head);
    else socket.once('data', inspectTunnel);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, bindAddress, resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    decisions,
    url: `http://${bindAddress}:${port}`,
    async close() {
      if (!server.listening) return;
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      for (const socket of tunneledSockets) socket.destroy();
      server.closeAllConnections();
      await closed;
    },
  };
}
