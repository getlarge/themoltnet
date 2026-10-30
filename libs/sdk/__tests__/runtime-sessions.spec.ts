import { createClient } from '@moltnet/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    const { sessions, requests } = setup(
      () =>
        new Response(JSON.stringify({ seq: 1, headSeq: 1, count: 0 }) + '\n'),
    );
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
    const page = await sessions.read('store', 1, options);
    page.close();
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
    const { sessions, requests } = setup(
      () => new Response('{"headSeq":0,"count":0}\n'),
    );
    const controller = new AbortController();
    const requestOptions = { ...options, signal: controller.signal };
    const page = await sessions.read('store', 0, requestOptions);
    page.close();
    await sessions.getForAttempt(
      { taskId: 'task', attemptN: 1 },
      requestOptions,
    );
    controller.abort();
    expect(requests.every((request) => request.signal.aborted)).toBe(true);
  });
  const commit = {
    seq: 1,
    commitId: '11111111-1111-4111-8111-111111111111',
    sha256: 'a'.repeat(64),
    writes: [{ value: 'été' }],
  };
  it('yields records before EOF and cancels the body on early return', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel,
    });
    const { sessions } = setup(() => new Response(body));
    const bytes = new TextEncoder().encode(
      JSON.stringify({ headSeq: 2, count: 2 }) +
        '\n' +
        JSON.stringify(commit) +
        '\n',
    );
    // Split within a UTF-8 character, and leave the second commit unavailable.
    const split = bytes.indexOf(0xc3) + 1;
    controller.enqueue(bytes.slice(0, split));
    controller.enqueue(bytes.slice(split));
    const page = await sessions.read('store', 0, options);
    for await (const value of page.items) {
      expect(value).toEqual(commit);
      break;
    }
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('closes a page whose items are never iterated', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel,
    });
    const { sessions } = setup(() => new Response(body));
    controller.enqueue(new TextEncoder().encode('{"headSeq":0,"count":0}\n'));

    const page = await sessions.read('store', 0, options);
    page.close();

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });
  it.each([
    JSON.stringify({ headSeq: 1, count: 1 }) + '\n',
    JSON.stringify({ headSeq: 1, count: 1 }) + '\n' + JSON.stringify(commit),
    JSON.stringify({ headSeq: 2, count: 1 }) +
      '\n' +
      JSON.stringify({ ...commit, seq: 2 }) +
      '\n',
  ])('rejects incomplete or out-of-order streams', async (body) => {
    const { sessions } = setup(() => new Response(body));
    const page = await sessions.read('store', 0, options);
    await expect(collect(page.items)).rejects.toThrow('runtime store stream');
  });
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

describe('Durable operation retries', () => {
  afterEach(() => vi.useRealTimers());
  const commit = {
    ...writer,
    commitId: 'stable-commit',
    expectedSeq: 4,
    writes: [],
  };

  it('replays identical append bytes after a lost acknowledgment and temporary 503', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const { sessions, requests } = setup(() => {
      attempt++;
      if (attempt === 1) throw new TypeError('fetch failed after publication');
      if (attempt === 2)
        return Response.json({ title: 'Unavailable' }, { status: 503 });
      return Response.json({ seq: 5 });
    });
    const appended = sessions.append('store', commit, options);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(appended).resolves.toEqual({ seq: 5 });
    expect(requests).toHaveLength(3);
    expect(
      new Set(await Promise.all(requests.map((r) => r.clone().text()))).size,
    ).toBe(1);
    expect(JSON.parse(await requests[0].clone().text())).toEqual(commit);
  });

  it('allocates a fresh candidate after a lost ID response and database contention', async () => {
    vi.useFakeTimers();
    let nextId = 2;
    let calls = 0;
    const { sessions, requests } = setup(() => {
      if (++calls === 1) {
        nextId++; // Allocated, but the response never reached the caller.
        throw new TypeError('lost allocation response');
      }
      if (calls === 2) return Response.json({}, { status: 503 });
      return Response.json({ id: nextId++ });
    });
    const allocated = sessions.mintId('store', writer, options);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(allocated).resolves.toEqual({ id: 3 });
    await expect(sessions.mintId('store', writer, options)).resolves.toEqual({
      id: 4,
    });
    for (const request of requests)
      expect(await request.json()).toEqual(writer);
  });

  it('does not retry ID allocation with stale writer authority', async () => {
    const { sessions, requests } = setup(() =>
      Response.json({}, { status: 409 }),
    );
    await expect(
      sessions.mintId('store', writer, options),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(requests).toHaveLength(1);
  });

  it('retries renewal with the same authority', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const { sessions, requests } = setup(() =>
      ++attempt === 1
        ? Response.json({}, { status: 502 })
        : Response.json({ writerExpiresAt: '2026-10-11T12:00:30Z' }),
    );
    const renewed = sessions.renew('store', writer, options);
    await vi.advanceTimersByTimeAsync(1_000);
    await renewed;
    expect(requests).toHaveLength(2);
    expect(await requests[1].json()).toEqual(writer);
  });

  it.each([400, 401, 403, 409, 429])(
    'does not add a retry layer for status %i',
    async (status) => {
      const { sessions, requests } = setup(() =>
        Response.json({ title: 'Rejected' }, { status }),
      );
      await expect(
        sessions.append('store', commit, options),
      ).rejects.toMatchObject({ statusCode: status });
      expect(requests).toHaveLength(1);
    },
  );

  it('honors server Retry-After beyond the client backoff cap', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const { sessions, requests } = setup(() =>
      ++attempt === 1
        ? Response.json({}, { status: 503, headers: { 'Retry-After': '2' } })
        : Response.json({ seq: 5 }),
    );
    const appended = sessions.append('store', commit, options);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(appended).resolves.toEqual({ seq: 5 });
    expect(requests).toHaveLength(2);
  });

  it.each(['append', 'mintId'] as const)(
    'bounds %s failures to four requests',
    async (method) => {
      vi.useFakeTimers();
      const { sessions, requests } = setup(() =>
        Response.json({}, { status: 503 }),
      );
      const rejected = expect(
        method === 'append'
          ? sessions.append('store', commit, options)
          : sessions.mintId('store', writer, options),
      ).rejects.toMatchObject({ statusCode: 503 });
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
      expect(requests).toHaveLength(4);
    },
  );

  it.each(['append', 'mintId'] as const)(
    'stops %s backoff when the operation budget expires',
    async (method) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const { sessions, requests } = setup(() => {
        setTimeout(() => controller.abort(new Error('lease deadline')), 50);
        return Response.json({}, { status: 503 });
      });
      const rejected = expect(
        method === 'append'
          ? sessions.append('store', commit, {
              ...options,
              signal: controller.signal,
            })
          : sessions.mintId('store', writer, {
              ...options,
              signal: controller.signal,
            }),
      ).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(2_000);
      await rejected;
      expect(requests).toHaveLength(1);
    },
  );

  it('does not replay writer acquisition after an ambiguous response', async () => {
    const { sessions, requests } = setup(() => {
      throw new TypeError('fetch failed');
    });
    await expect(sessions.open(authority, options)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it('retries read headers while retaining the commit cursor', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const { sessions, requests } = setup(() =>
      ++attempt === 1
        ? Response.json({}, { status: 503 })
        : new Response('{"headSeq":4,"count":0}\n'),
    );
    const reading = sessions.read('store', 4, options);
    await vi.advanceTimersByTimeAsync(1_000);
    const page = await reading;
    page.close();
    expect(
      requests.map((r) => new URL(r.url).searchParams.get('afterSeq')),
    ).toEqual(['4', '4']);
  });
});
