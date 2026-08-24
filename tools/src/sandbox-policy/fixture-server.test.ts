import { request } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { type PolicyFixture, startPolicyFixture } from './fixture-server.js';

interface ResponseSummary {
  location?: string;
  status: number;
}

function get(
  port: number,
  path: string,
  token?: string,
): Promise<ResponseSummary> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
      (response) => {
        response.resume();
        response.once('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            ...(response.headers.location
              ? { location: response.headers.location }
              : {}),
          }),
        );
      },
    );
    req.once('error', reject);
    req.end();
  });
}

describe('sandbox policy loopback fixture', () => {
  let fixture: PolicyFixture | undefined;

  afterEach(async () => fixture?.close());

  it('mints credentials and records only value-free match evidence', async () => {
    fixture = await startPolicyFixture();
    const initial = fixture.credential;

    expect(
      await get(fixture.allowedPort, fixture.path('/allowed'), initial),
    ).toMatchObject({ status: 200 });
    expect(
      await get(fixture.allowedPort, fixture.path('/wrong'), 'wrong-token'),
    ).toMatchObject({ status: 401 });
    const rotated = fixture.rotate();
    expect(
      await get(fixture.allowedPort, fixture.path('/allowed'), rotated),
    ).toMatchObject({ status: 200 });
    fixture.restore(initial);
    expect(
      await get(fixture.allowedPort, fixture.path('/allowed'), initial),
    ).toMatchObject({ status: 200 });

    expect(
      fixture.requests.map(({ credentialMatch }) => credentialMatch),
    ).toEqual(['expected', 'unexpected', 'expected', 'expected']);
    const evidence = JSON.stringify(fixture.requests);
    expect(evidence).not.toContain(initial);
    expect(evidence).not.toContain(rotated);
    expect(fixture.sensitiveValues()).toEqual([initial, rotated]);
    const activeFixture = fixture;
    expect(() => activeFixture.restore('unknown-token')).toThrow(
      'not minted by this fixture',
    );
  });

  it('records pathname only and exercises the redirect target', async () => {
    fixture = await startPolicyFixture('127.0.0.1', 'fixture.internal');
    const captureStart = fixture.requests.length;
    const redirect = await get(
      fixture.allowedPort,
      `${fixture.path('/redirect')}?credential=must-not-persist`,
      fixture.credential,
    );
    const location = new URL(redirect.location ?? '');

    expect(redirect.status).toBe(302);
    expect(location.hostname).toBe('fixture.internal');
    expect(await get(fixture.adjacentPort, location.pathname)).toMatchObject({
      status: 200,
    });
    expect(fixture.capture(captureStart)).toEqual([
      expect.objectContaining({
        destination: 'allowed',
        path: '/redirect',
      }),
      expect.objectContaining({
        destination: 'adjacent',
        credentialMatch: 'absent',
        path: '/redirect-target',
      }),
    ]);
    expect(JSON.stringify(fixture.requests)).not.toContain('must-not-persist');
    expect(() => fixture?.capture(-1)).toThrow('non-negative integer');
  });

  it('ignores requests without the per-run path nonce and closes twice', async () => {
    fixture = await startPolicyFixture();

    expect(await get(fixture.allowedPort, '/allowed')).toMatchObject({
      status: 404,
    });
    expect(fixture.requests).toEqual([]);
    await expect(
      Promise.all([fixture.close(), fixture.close()]),
    ).resolves.toEqual([undefined, undefined]);
  });
});
