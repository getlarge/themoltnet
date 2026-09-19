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
    await projects.create('team', { name: 'Project' });
    await projects.list('team');
    await projects.get('team', 'project');
    await projects.update('team', 'project', { name: 'Renamed' });
    await projects.archive('team', 'project');
    const requests = fetch.mock.calls.map(([request]) => request as Request);
    expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ['POST', '/teams/team/projects'],
      ['GET', '/teams/team/projects'],
      ['GET', '/teams/team/projects/project'],
      ['PATCH', '/teams/team/projects/project'],
      ['PATCH', '/teams/team/projects/project'],
    ]);
    expect(await requests[4].json()).toEqual({ archived: true });
    expect(
      requests.every((r) => r.headers.get('x-moltnet-team-id') === 'team'),
    ).toBe(true);
  });
});
