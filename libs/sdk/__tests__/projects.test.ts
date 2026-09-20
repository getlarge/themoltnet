import { createClient } from '@moltnet/api-client';
import { describe, expect, it, vi } from 'vitest';

import { createProjectsNamespace } from '../src/namespaces/projects.js';

describe('projects namespace', () => {
  it('addresses the selected team for create, list, get, update and archive', async () => {
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response('{}', {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const projects = createProjectsNamespace({
      client: createClient({ baseUrl: 'https://api.example', fetch }),
    });
    await projects.create({ name: 'Project' }, { teamId: 'team' });
    await projects.list(undefined, { teamId: 'team' });
    await projects.get('project', { teamId: 'team' });
    await projects.update('project', { name: 'Renamed' }, { teamId: 'team' });
    await projects.archive('project', { teamId: 'team' });
    await projects.unarchive('project', { teamId: 'team' });
    const requests = fetch.mock.calls.map(([request]) => request as Request);
    expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ['POST', '/projects'],
      ['GET', '/projects'],
      ['GET', '/projects/project'],
      ['PATCH', '/projects/project'],
      ['PATCH', '/projects/project'],
      ['PATCH', '/projects/project'],
    ]);
    expect(await requests[4].json()).toEqual({ archived: true });
    expect(await requests[5].json()).toEqual({ archived: false });
    expect(
      requests.every((r) => r.headers.get('x-moltnet-team-id') === 'team'),
    ).toBe(true);
  });
});
