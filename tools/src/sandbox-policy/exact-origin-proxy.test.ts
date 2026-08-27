import { request } from 'node:http';
import { createConnection } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ADJACENT_FIXTURE_HOST,
  type ExactOriginProxy,
  PROTECTED_FIXTURE_HOST,
  startExactOriginProxy,
} from './exact-origin-proxy.js';
import { type PolicyFixture, startPolicyFixture } from './fixture-server.js';

const fixtures: PolicyFixture[] = [];
const proxies: ExactOriginProxy[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe('exact-origin upstream proxy', () => {
  it('preserves credentials only for the canonical protected origin', async () => {
    const fixture = await createFixture();
    const proxy = await createProxy(fixture);
    const authorization = `Bearer ${fixture.credential}`;

    const protectedStatus = await proxyRequest(
      proxy,
      `http://${PROTECTED_FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/protected')}`,
      authorization,
      true,
    );
    const wrongHostStatus = await proxyRequest(
      proxy,
      `http://${ADJACENT_FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/wrong-host')}`,
      authorization,
    );
    const wrongPortStatus = await proxyRequest(
      proxy,
      `http://${PROTECTED_FIXTURE_HOST}:${fixture.adjacentPort}${fixture.path('/wrong-port')}`,
      authorization,
    );
    const adjacentStatus = await proxyRequest(
      proxy,
      `http://${ADJACENT_FIXTURE_HOST}:${fixture.adjacentPort}${fixture.path('/adjacent')}`,
      authorization,
    );

    expect([
      protectedStatus,
      wrongHostStatus,
      wrongPortStatus,
      adjacentStatus,
    ]).toEqual([200, 403, 403, 403]);
    expect(fixture.requests).toMatchObject([
      { credentialMatch: 'expected', destination: 'allowed' },
    ]);
    expect(proxy.decisions).toEqual([
      {
        action: 'forward',
        credential: 'preserved',
        protocol: 'http',
        route: 'protected',
      },
      {
        action: 'deny',
        credential: 'leaked',
        protocol: 'http',
        route: 'wrong-host',
      },
      {
        action: 'deny',
        credential: 'leaked',
        protocol: 'http',
        route: 'wrong-port',
      },
      {
        action: 'deny',
        credential: 'leaked',
        protocol: 'http',
        route: 'adjacent',
      },
    ]);
  });

  it('fails closed for wrong protocols and every unmapped origin', async () => {
    const fixture = await createFixture();
    const proxy = await createProxy(fixture);
    const authorization = `Bearer ${fixture.credential}`;

    const protocolStatus = await proxyRequest(
      proxy,
      `https://${PROTECTED_FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/wrong-protocol')}`,
      authorization,
    );
    const unmappedStatus = await proxyRequest(
      proxy,
      `http://203.0.113.10:${fixture.allowedPort}${fixture.path('/unmapped')}`,
      authorization,
    );

    expect([protocolStatus, unmappedStatus]).toEqual([403, 403]);
    expect(fixture.requests).toHaveLength(0);
    expect(proxy.decisions).toMatchObject([
      { action: 'deny', credential: 'leaked', route: 'wrong-protocol' },
      { action: 'deny', credential: 'leaked', route: 'unmapped' },
    ]);
  });

  it('forwards explicit network fixtures without credentials', async () => {
    const fixture = await createFixture();
    const proxy = await createProxy(fixture);

    const statuses = await Promise.all(
      ['localhost', 'host.docker.internal'].map((hostname) =>
        proxyRequest(
          proxy,
          `http://${hostname}:${fixture.allowedPort}${fixture.path('/network')}`,
          `Bearer ${fixture.credential}`,
        ),
      ),
    );

    expect(statuses).toEqual([403, 403]);
    expect(fixture.requests).toMatchObject([]);
    expect(proxy.decisions).toMatchObject([
      {
        action: 'deny',
        credential: 'leaked',
        route: 'network-allowed',
      },
      {
        action: 'deny',
        credential: 'leaked',
        route: 'network-allowed',
      },
    ]);
  });

  it('terminates Docker-style HTTP tunnels and rejects TLS before forwarding', async () => {
    const fixture = await createFixture();
    const proxy = await createProxy(fixture);

    const status = await tunneledHttpRequest(
      proxy,
      `http://${PROTECTED_FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/tunneled')}`,
      `Bearer ${fixture.credential}`,
    );
    const mismatchedOrigin = await tunneledHttpRequest(
      proxy,
      `http://${PROTECTED_FIXTURE_HOST}:${fixture.allowedPort}${fixture.path('/mismatch')}`,
      `Bearer ${fixture.credential}`,
      `${ADJACENT_FIXTURE_HOST}:${fixture.allowedPort}`,
    );
    await sendTlsPrefix(
      proxy,
      `${PROTECTED_FIXTURE_HOST}:${fixture.allowedPort}`,
    );

    expect(status).toBe(200);
    expect(mismatchedOrigin).toBe(403);
    expect(fixture.requests).toMatchObject([
      { credentialMatch: 'expected', destination: 'allowed' },
    ]);
    expect(proxy.decisions).toMatchObject([
      { action: 'forward', protocol: 'http', route: 'protected' },
      { action: 'deny', protocol: 'http', route: 'unmapped' },
      { action: 'deny', protocol: 'https', route: 'wrong-protocol' },
    ]);
  });
});

async function createFixture(): Promise<PolicyFixture> {
  const fixture = await startPolicyFixture();
  fixtures.push(fixture);
  return fixture;
}

async function createProxy(fixture: PolicyFixture): Promise<ExactOriginProxy> {
  const proxy = await startExactOriginProxy(fixture);
  proxies.push(proxy);
  return proxy;
}

function proxyRequest(
  proxy: ExactOriginProxy,
  destination: string,
  authorization: string,
  originForm = false,
): Promise<number> {
  const proxyUrl = new URL(proxy.url);
  const destinationUrl = new URL(destination);
  return new Promise((resolve, reject) => {
    const clientRequest = request(
      {
        headers: {
          authorization,
          ...(originForm ? { host: destinationUrl.host } : {}),
        },
        host: proxyUrl.hostname,
        method: 'GET',
        path: originForm
          ? `${destinationUrl.pathname}${destinationUrl.search}`
          : destination,
        port: proxyUrl.port,
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      },
    );
    clientRequest.once('error', reject);
    clientRequest.end();
  });
}

function tunneledHttpRequest(
  proxy: ExactOriginProxy,
  destination: string,
  authorization: string,
  innerHost?: string,
): Promise<number> {
  const proxyUrl = new URL(proxy.url);
  const destinationUrl = new URL(destination);
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port),
    });
    let buffer = Buffer.alloc(0);
    let tunnelEstablished = false;
    let settled = false;
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write(
        `CONNECT ${destinationUrl.host} HTTP/1.1\r\nHost: ${destinationUrl.host}\r\n\r\n`,
      );
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!tunnelEstablished) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        if (!buffer.subarray(0, headerEnd).toString().includes(' 200 ')) {
          reject(new Error('proxy tunnel was rejected'));
          socket.destroy();
          return;
        }
        tunnelEstablished = true;
        buffer = Buffer.alloc(0);
        socket.write(
          `GET ${destinationUrl.pathname}${destinationUrl.search} HTTP/1.1\r\nHost: ${innerHost ?? destinationUrl.host}\r\nAuthorization: ${authorization}\r\nConnection: close\r\n\r\n`,
        );
        return;
      }
      const status = /^HTTP\/1\.1 (\d+)/.exec(buffer.toString())?.[1];
      if (status) {
        settled = true;
        resolve(Number(status));
        socket.destroy();
      }
    });
    socket.once('close', () => {
      if (!settled) reject(new Error('tunneled response had no status'));
    });
  });
}

function sendTlsPrefix(
  proxy: ExactOriginProxy,
  authority: string,
): Promise<void> {
  const proxyUrl = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port),
    });
    let response = Buffer.alloc(0);
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      );
    });
    socket.on('data', (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      if (response.includes('\r\n\r\n')) {
        response = Buffer.alloc(0);
        socket.write(Buffer.from([0x16, 0x03, 0x03, 0x00, 0x01]));
      }
    });
    socket.once('close', () => resolve());
  });
}
