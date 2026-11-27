/**
 * A rejected token request must say who made it. Without the grant type,
 * client and caller in the log, a burst of `invalid_client` responses from the
 * upstream provider cannot be traced back to the agent or service sending it.
 * Secrets in the request (client secret, refresh token, code) never appear.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
} from './helpers.js';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

interface LogLine {
  level: number;
  msg: string;
  [key: string]: unknown;
}

/** Collect pino NDJSON lines written to this stream. */
function captureStream(): { lines: LogLine[]; write(s: string): void } {
  const lines: LogLine[] = [];
  return {
    lines,
    write(s: string) {
      for (const part of s.split('\n')) {
        if (part.trim()) lines.push(JSON.parse(part) as LogLine);
      }
    },
  };
}

function upstream(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  };
}

const REJECTED = 'OAuth2 token request rejected';

describe('POST /oauth2/token rejection logging', () => {
  let app: FastifyInstance;
  let mocks: MockServices;
  let sink: ReturnType<typeof captureStream>;

  beforeEach(async () => {
    fetchMock.mockReset();
    mocks = createMockServices();
    sink = captureStream();
    app = await createTestApp(mocks, null, undefined, undefined, undefined, {
      level: 'info',
      stream: sink,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (
    payload: Record<string, string>,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'POST',
      url: '/oauth2/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'agent-daemon/1.2.3',
        ...headers,
      },
      payload: new URLSearchParams(payload).toString(),
    });

  const rejections = () => sink.lines.filter((line) => line.msg === REJECTED);

  it('logs the grant, client and caller when the provider rejects the client', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(upstream({ error: 'invalid_client' }, 401));

    // Act
    const res = await post({
      grant_type: 'client_credentials',
      client_id: 'agent-client-1',
      client_secret: 'super-secret-value',
    });

    // Assert
    expect(res.statusCode).toBe(401);
    expect(rejections()).toEqual([
      expect.objectContaining({
        level: 30,
        grantType: 'client_credentials',
        clientId: 'agent-client-1',
        clientAuth: 'body',
        status: 401,
        error: 'invalid_client',
        ip: '127.0.0.1',
        userAgent: 'agent-daemon/1.2.3',
      }),
    ]);
    expect(JSON.stringify(sink.lines)).not.toContain('super-secret-value');
  });

  it('takes the client from Basic authentication without logging its secret', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(upstream({ error: 'invalid_client' }, 401));
    const basic = Buffer.from('basic-client:basic-secret').toString('base64');

    // Act
    await post(
      { grant_type: 'client_credentials' },
      { authorization: `Basic ${basic}` },
    );

    // Assert
    expect(rejections()).toEqual([
      expect.objectContaining({
        clientId: 'basic-client',
        clientAuth: 'basic',
      }),
    ]);
    const logged = JSON.stringify(sink.lines);
    expect(logged).not.toContain('basic-secret');
    expect(logged).not.toContain(basic);
  });

  it('records a request that names no client at all', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(upstream({ error: 'invalid_client' }, 401));

    // Act
    await post({ grant_type: 'refresh_token', refresh_token: 'RT-SECRET' });

    // Assert
    expect(rejections()).toEqual([
      expect.objectContaining({
        grantType: 'refresh_token',
        clientId: null,
        clientAuth: 'none',
        error: 'invalid_client',
      }),
    ]);
    expect(JSON.stringify(sink.lines)).not.toContain('RT-SECRET');
  });

  it('logs nothing extra for a successful grant', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(
      upstream(
        { access_token: 'tok', token_type: 'bearer', expires_in: 3600 },
        200,
      ),
    );

    // Act
    const res = await post({
      grant_type: 'client_credentials',
      client_id: 'ok-client',
      client_secret: 'ok-secret',
    });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(rejections()).toEqual([]);
  });
});
