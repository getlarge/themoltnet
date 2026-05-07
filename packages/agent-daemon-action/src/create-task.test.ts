import { describe, expect, it, vi } from 'vitest';

import { createTask } from './create-task.js';

const BASE_INPUT = {
  apiUrl: 'https://api.moltnet.test',
  agentToken: 'tk',
  teamId: '11111111-1111-4111-8111-111111111111',
  diaryId: '22222222-2222-4222-8222-222222222222',
  correlationId: '33333333-3333-4333-8333-333333333333',
  referenceUrl: 'https://github.com/o/r/issues/9',
  title: 'Fix flaky test',
  brief: 'Issue body...',
};

describe('createTask', () => {
  it('POSTs the schema-correct body and returns the created task', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'task-1',
        correlationId: BASE_INPUT.correlationId,
      }),
    });

    const out = await createTask(BASE_INPUT, {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(out.id).toBe('task-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.moltnet.test/tasks');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer tk',
      'content-type': 'application/json',
    });

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      taskType: 'fulfill_brief',
      teamId: BASE_INPUT.teamId,
      diaryId: BASE_INPUT.diaryId,
      input: { brief: 'Issue body...', title: 'Fix flaky test' },
      references: [{ url: BASE_INPUT.referenceUrl, role: 'source' }],
      correlationId: BASE_INPUT.correlationId,
    });
  });

  it('omits title when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 't' }),
    });
    const { title: _omit, ...noTitle } = BASE_INPUT;
    void _omit;
    await createTask(noTitle, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as {
      input: { title?: string };
    };
    expect(body.input.title).toBeUndefined();
  });

  it('throws on non-2xx with the response body for diagnostics', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"bad teamId"}',
    });
    await expect(
      createTask(BASE_INPUT, { fetch: fetchMock as unknown as typeof fetch }),
    ).rejects.toThrow(/400.*bad teamId/);
  });
});
