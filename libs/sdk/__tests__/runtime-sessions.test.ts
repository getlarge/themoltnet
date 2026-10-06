import { createClient } from '@moltnet/api-client';
import { describe, expect, it, vi } from 'vitest';

import { createRuntimeSessionsNamespace } from '../src/namespaces/runtime-sessions.js';

const authority = {
  taskId: 'task',
  attemptN: 1,
  leaseId: 'lease',
  executorFingerprint: 'executor',
};
const writer = { ...authority, writerToken: 'writer' };
const options = { teamId: 'team' };

function setup(response: () => Response) {
  const requests: Request[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    requests.push(new Request(input, init));
    return response();
  });
  const client = createClient({ baseUrl: 'https://api.example.test', fetch });
  return {
    sessions: createRuntimeSessionsNamespace({ client, auth: 'token' }),
    requests,
  };
}

describe('runtime session persistence', () => {
  it('uses the same authenticated namespace for incremental commits and existing artifacts', async () => {
    const { sessions, requests } = setup(() => Response.json({ seq: 1 }));
    await sessions.getDurableForAttempt('task', 1, options);
    await sessions.open(authority, options);
    await sessions.renew('store', writer, options);
    await sessions.mintId('store', writer, options);
    await sessions.append(
      'store',
      {
        ...writer,
        commitId: 'commit',
        expectedSeq: 0,
        writes: [{ type: 'entry', value: { id: 2 } }],
      },
      options,
    );
    await sessions.read('store', 1, options);
    await sessions.getForAttempt({ taskId: 'task', attemptN: 1 }, options);

    expect(
      requests.map((request) => [
        request.method,
        new URL(request.url).pathname,
      ]),
    ).toEqual([
      ['GET', '/runtime-sessions/durable/attempt'],
      ['POST', '/runtime-sessions/durable/open'],
      ['POST', '/runtime-sessions/durable/store/renew'],
      ['POST', '/runtime-sessions/durable/store/ids'],
      ['POST', '/runtime-sessions/durable/store/commits'],
      ['GET', '/runtime-sessions/durable/store/commits'],
      ['GET', '/runtime-sessions/task/1'],
    ]);
    for (const request of requests) {
      expect(request.headers.get('x-moltnet-team-id')).toBe('team');
      expect(request.headers.get('authorization')).toBe('Bearer token');
    }
    expect(new URL(requests[0].url).searchParams.get('attemptN')).toBe('1');
    expect(new URL(requests[5].url).searchParams.get('afterSeq')).toBe('1');
    expect(await requests[4].json()).toMatchObject({
      expectedSeq: 0,
      writerToken: 'writer',
    });
  });

  it('accepts a successful empty release response', async () => {
    const { sessions } = setup(() => new Response(null, { status: 204 }));
    await expect(
      sessions.release('store', writer, options),
    ).resolves.toBeUndefined();
  });

  it('propagates stale-writer rejection on release', async () => {
    const { sessions } = setup(() =>
      Response.json({ title: 'Conflict', status: 409 }, { status: 409 }),
    );
    await expect(
      sessions.release('store', writer, options),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('forwards cancellation to incremental and artifact reads', async () => {
    const { sessions, requests } = setup(() => Response.json(null));
    const controller = new AbortController();
    const requestOptions = { ...options, signal: controller.signal };
    await sessions.read('store', 0, requestOptions);
    await sessions.getForAttempt(
      { taskId: 'task', attemptN: 1 },
      requestOptions,
    );
    controller.abort();
    expect(requests.every((request) => request.signal.aborted)).toBe(true);
  });
});
