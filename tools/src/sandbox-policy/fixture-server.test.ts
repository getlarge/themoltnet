import { request } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { type PolicyFixture, startPolicyFixture } from './fixture-server.js';

function get(port: number, path: string, token?: string): Promise<number> {
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
        response.once('end', () => resolve(response.statusCode ?? 0));
      },
    );
    req.once('error', reject);
    req.end();
  });
}

describe('sandbox policy loopback fixture', () => {
  let fixture: PolicyFixture | undefined;

  afterEach(async () => fixture?.close());

  it('records only value-free credential match evidence', async () => {
    fixture = await startPolicyFixture('synthetic-one');

    expect(await get(fixture.allowedPort, '/allowed', 'synthetic-one')).toBe(
      200,
    );
    expect(await get(fixture.adjacentPort, '/adjacent')).toBe(200);
    fixture.rotate('synthetic-two');
    expect(await get(fixture.allowedPort, '/allowed', 'synthetic-two')).toBe(
      200,
    );

    expect(fixture.requests).toEqual([
      expect.objectContaining({
        destination: 'allowed',
        credentialMatch: 'expected',
      }),
      expect.objectContaining({
        destination: 'adjacent',
        credentialMatch: 'absent',
      }),
      expect.objectContaining({
        destination: 'allowed',
        credentialMatch: 'expected',
      }),
    ]);
    expect(JSON.stringify(fixture.requests)).not.toContain('synthetic-one');
    expect(JSON.stringify(fixture.requests)).not.toContain('synthetic-two');
  });
});
