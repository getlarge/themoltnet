// The watcher only uses fetch and streams; jsdom's AbortSignal is not accepted
// by Node's Request, so this suite runs in the node environment.
// @vitest-environment node
import { createClient } from '@moltnet/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  type ConversationSnapshot,
  watchConversationSnapshots,
} from '../src/tasks/conversation-stream.js';

const TEAM = 'bbbbbbbb-0000-0000-0000-000000000002';
const TASK = 'aaaaaaaa-0000-0000-0000-000000000001';

function snapshot(
  cursor: string,
  attemptStatus: string,
  text = cursor,
): ConversationSnapshot {
  return {
    conversationId: '1',
    cursor,
    attemptStatus,
    live: {},
    nextBeforeEntryId: null,
    messages: [
      {
        id: 'partial/1',
        entryId: null,
        entryKind: 'pi.assistant',
        inherited: false,
        status: 'streaming',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      },
    ],
  };
}

const frame = (value: ConversationSnapshot) =>
  `id: ${value.cursor}\nevent: conversation.snapshot\ndata: ${JSON.stringify(value)}\n\n`;

/** An SSE body; `open` keeps it from closing until the request aborts. */
function sseResponse(chunks: string[], open = false): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!open) controller.close();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function setup(responses: { events: Response[]; reads?: Response[] }) {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: Request) => {
    requests.push(input);
    const queue = input.url.endsWith('/events')
      ? responses.events
      : (responses.reads ?? []);
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${input.url}`);
    return next;
  });
  const client = createClient({
    baseUrl: 'http://api.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const controller = new AbortController();
  // Resolves immediately; aborts if a test would otherwise loop forever.
  const sleep = vi.fn(async (_ms: number, signal: AbortSignal) => {
    if (sleep.mock.calls.length > 20) controller.abort();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  });
  const onSnapshot = vi.fn<(value: ConversationSnapshot) => void>();
  const onFallback = vi.fn();
  const onConnection = vi.fn();
  const watch = () =>
    watchConversationSnapshots({
      client,
      teamId: TEAM,
      taskId: TASK,
      attemptN: 1,
      conversationId: '1',
      signal: controller.signal,
      onSnapshot,
      onFallback,
      onConnection,
      reconnectDelayMs: 5,
      pollIntervalMs: 7,
      sleep,
    });
  return {
    requests,
    fetch,
    sleep,
    onSnapshot,
    onFallback,
    onConnection,
    controller,
    watch,
  };
}

describe('watchConversationSnapshots', () => {
  it('replaces the snapshot with every frame and stops at a terminal status', async () => {
    const t = setup({
      events: [
        sseResponse([
          frame(snapshot('a', 'running', 'Now')),
          ': keepalive\n\n',
          frame(snapshot('b', 'running', 'Now writing')),
          frame(snapshot('c', 'completed', 'Now writing it')),
        ]),
      ],
    });

    await t.watch();

    expect(t.onSnapshot.mock.calls.map(([value]) => value.cursor)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.requests[0]?.headers.get('x-moltnet-team-id')).toBe(TEAM);
    expect(t.requests[0]?.url).toBe(
      `http://api.test/tasks/${TASK}/attempts/1/conversations/1/events`,
    );
    expect(t.onFallback).not.toHaveBeenCalled();
  });

  it('reconnects when the server closes the stream', async () => {
    const t = setup({
      events: [
        sseResponse([frame(snapshot('a', 'running'))]),
        sseResponse([frame(snapshot('b', 'completed'))]),
      ],
    });

    await t.watch();

    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.sleep).toHaveBeenCalledWith(5, expect.any(AbortSignal));
    expect(t.onSnapshot.mock.calls.map(([value]) => value.cursor)).toEqual([
      'a',
      'b',
    ]);
  });

  it('aborts the open request and resolves when the signal aborts', async () => {
    const t = setup({
      events: [sseResponse([frame(snapshot('a', 'running'))], true)],
    });
    t.onSnapshot.mockImplementation(() => t.controller.abort());

    await expect(t.watch()).resolves.toBeUndefined();

    expect(t.onSnapshot).toHaveBeenCalledTimes(1);
    expect(t.requests[0]?.signal.aborted).toBe(true);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.onFallback).not.toHaveBeenCalled();
  });

  it('falls back to polling when the stream fails', async () => {
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
      });
    const t = setup({
      events: [new Response('unavailable', { status: 503 })],
      reads: [
        json(snapshot('a', 'running')),
        new Response('{}', { status: 500 }),
        json(snapshot('b', 'completed')),
      ],
    });

    await t.watch();

    expect(t.onFallback).toHaveBeenCalledTimes(1);
    expect(t.onSnapshot.mock.calls.map(([value]) => value.cursor)).toEqual([
      'a',
      'b',
    ]);
    expect(t.sleep).toHaveBeenCalledWith(7, expect.any(AbortSignal));
    expect(t.fetch).toHaveBeenCalledTimes(4);
  });

  it('falls back to polling after repeated streams without a snapshot', async () => {
    const t = setup({
      events: [
        sseResponse([': keepalive\n\n']),
        sseResponse([]),
        sseResponse([': keepalive\n\n']),
      ],
      reads: [
        new Response(JSON.stringify(snapshot('a', 'failed')), {
          headers: { 'content-type': 'application/json' },
        }),
      ],
    });

    await t.watch();

    expect(t.onFallback).toHaveBeenCalledTimes(1);
    expect(t.onSnapshot).toHaveBeenCalledTimes(1);
  });
  it('aborts the HTTP request when a terminal snapshot arrives on an otherwise open stream', async () => {
    const t = setup({
      events: [sseResponse([frame(snapshot('done', 'completed'))], true)],
    });
    await t.watch();
    expect(t.requests[0].signal.aborted).toBe(true);
  });

  it('backs off failed polling, reports staleness, and clears it after recovery', async () => {
    const t = setup({
      events: [new Response('', { status: 503 })],
      reads: [
        new Response('{}', { status: 500 }),
        new Response('{}', { status: 503 }),
        new Response(JSON.stringify(snapshot('done', 'completed')), {
          headers: { 'content-type': 'application/json' },
        }),
      ],
    });
    await t.watch();
    expect(t.sleep.mock.calls.map(([ms]) => ms)).toEqual([7, 14]);
    expect(t.onConnection.mock.calls.map(([state]) => state)).toEqual([
      'retrying',
      'retrying',
      'retrying',
      'connected',
    ]);
  });

  it.each([401, 403, 404])('stops polling on HTTP %s', async (status) => {
    const t = setup({
      events: [new Response('', { status: 503 })],
      reads: [new Response('{}', { status })],
    });
    await expect(t.watch()).rejects.toMatchObject({ status });
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.sleep).not.toHaveBeenCalled();
  });
});
