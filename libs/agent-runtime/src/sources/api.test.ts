import { describe, expect, it, vi } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { ApiTaskSource } from './api.js';

describe('ApiTaskSource', () => {
  it('claims one task and returns the API attempt number', async () => {
    const task = makeFulfillBriefTask({
      status: 'dispatched',
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          task,
          attempt: {
            task_id: task.id,
            attempt_n: 3,
            claimed_by_agent_id: '33333333-3333-4333-8333-333333333333',
            runtime_id: null,
            claimed_at: '2026-04-23T10:00:00Z',
            started_at: null,
            completed_at: null,
            status: 'claimed',
            output: null,
            output_cid: null,
            error: null,
            usage: null,
            content_signature: null,
            signed_at: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const src = new ApiTaskSource({
      baseUrl: 'https://api.example.test/',
      taskId: task.id,
      auth: async () => 'token-123',
      leaseTtlSec: 120,
      fetch: fetchMock,
    });

    await expect(src.claim()).resolves.toEqual({ task, attemptN: 3 });
    await expect(src.claim()).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall?.[0]).toBe(
      `https://api.example.test/tasks/${task.id}/claim`,
    );
    expect(firstCall?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-123',
        'Content-Type': 'application/json',
      },
    });
  });

  it('surfaces non-2xx claim failures', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('nope', { status: 409, statusText: 'Conflict' }),
    );
    const src = new ApiTaskSource({
      baseUrl: 'https://api.example.test',
      taskId: '11111111-1111-4111-8111-111111111111',
      auth: async () => 'token-123',
      fetch: fetchMock,
    });

    await expect(src.claim()).rejects.toThrow(/409 Conflict/);
  });
});
