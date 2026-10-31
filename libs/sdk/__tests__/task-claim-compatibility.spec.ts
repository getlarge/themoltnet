import { createClient } from '@moltnet/api-client';
import { describe, expect, it, vi } from 'vitest';

import { createTasksNamespace } from '../src/namespaces/tasks.js';

describe('General task claim compatibility', () => {
  it('permits callers to omit the claim body', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task: { id: 'task', teamId: 'team', projectId: null },
          attempt: {},
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
    const tasks = createTasksNamespace({
      client: createClient({ baseUrl: 'https://api.example', fetch }),
    });
    await tasks.claim('task', undefined, { teamId: 'team' });
    const request = fetch.mock.calls[0][0] as Request;
    expect(await request.json()).toEqual({});
  });
});
