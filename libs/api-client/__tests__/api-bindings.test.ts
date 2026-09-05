import { describe, expect, it, vi } from 'vitest';

import { type ApiRequest,createClient, getTask } from '../src/api-bindings.js';

describe('API bindings', () => {
  it('routes generated requests through the caller-provided executor', async () => {
    const requestExecutor = vi.fn(async (_request: ApiRequest) => ({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'running',
    }));
    const client = createClient({
      baseUrl: 'https://api.themolt.net',
      requestExecutor,
    });

    const { data } = await getTask({
      client,
      headers: { 'x-moltnet-team-id': 'team-id' },
      path: { id: '33333333-3333-4333-8333-333333333333' },
      throwOnError: true,
    });

    expect(data).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'running',
    });
    expect(requestExecutor).toHaveBeenCalledWith({
      body: undefined,
      headers: { 'x-moltnet-team-id': 'team-id' },
      method: 'GET',
      signal: undefined,
      url: 'https://api.themolt.net/tasks/33333333-3333-4333-8333-333333333333',
    });
  });
});
