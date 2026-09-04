import { describe, expect, it, vi } from 'vitest';

import {
  createClient,
  getTask,
  type TransportRequest,
} from '../src/transport.js';

describe('transport client', () => {
  it('routes generated requests through the injected transport', async () => {
    const transport = vi.fn(async (_request: TransportRequest) => ({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'running',
    }));
    const client = createClient({
      baseUrl: 'https://api.themolt.net',
      transport,
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
    expect(transport).toHaveBeenCalledWith({
      body: undefined,
      headers: { 'x-moltnet-team-id': 'team-id' },
      method: 'GET',
      signal: undefined,
      url: 'https://api.themolt.net/tasks/33333333-3333-4333-8333-333333333333',
    });
  });
});
