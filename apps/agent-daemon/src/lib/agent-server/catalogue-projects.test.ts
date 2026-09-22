import { MoltNetError } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { buildCatalogue, type CatalogueAgentPort } from './catalogue.js';
import { ProjectPaginationError } from './catalogue-project-reader.js';

const project = {
  id: 'project-a',
  teamId: 'team-a',
  name: 'Research',
  description: 'Shared research project',
  defaultDiaryId: 'diary-a',
  archived: false,
};
function agent() {
  return {
    teamIds: ['team-a'],
    lastVerified: () => undefined,
    readTeam: vi.fn(async () => ({
      team: { id: 'team-a', name: 'Research team' },
      diaries: [{ id: 'diary-a', teamId: 'team-a', name: 'Research diary' }],
      profiles: [],
      credential: {
        keyId: 'key-a',
        expiresAt: null,
        verifiedAt: '2026-09-20T12:00:00.000Z',
        scopes: ['team:read'],
      },
    })),
    readProjects: vi.fn(async () => ({ items: [project], truncated: false })),
    readProject: vi.fn(async () => project),
  } satisfies CatalogueAgentPort;
}
const machine = {
  providerEnv: new Map<string, boolean>(),
  runtimeKinds: new Set<string>(),
};
const catalogue = (
  port: CatalogueAgentPort,
  logger?: { warn: ReturnType<typeof vi.fn> },
) => buildCatalogue({ agent: port, machine, identityDefault: {}, logger });

describe('project catalogue', () => {
  it('lists accessible active projects only from the verified team', async () => {
    const port = agent();
    port.readProjects.mockResolvedValue({
      items: [
        project,
        { ...project, id: 'foreign', teamId: 'team-b' },
        { ...project, id: 'archived', archived: true },
      ],
      truncated: false,
    });

    const result = await catalogue(port);

    expect(result.projects).toEqual([project]);
    expect(result.projectErrors).toEqual([]);
    expect(port.readProjects).toHaveBeenCalledWith('team-a');
  });

  it('keeps verified team access when project discovery fails, and logs why', async () => {
    const port = agent();
    port.readProjects.mockRejectedValue(new Error('Upstream unavailable'));
    const logger = { warn: vi.fn() };

    const result = await catalogue(port, logger);

    expect(result.teams[0]?.available).toBe(true);
    expect(result.teams[0]?.blockers).toEqual([]);
    expect(result.projects).toEqual([]);
    expect(result.projectErrors).toEqual([
      {
        teamId: 'team-a',
        code: 'unreachable',
        message: 'Projects could not be loaded. Retry project discovery.',
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-a',
        code: 'agent_server_project_discovery_failed',
      }),
      expect.any(String),
    );
  });

  it.each([
    [
      new MoltNetError('Forbidden', { code: 'FORBIDDEN', statusCode: 403 }),
      'forbidden',
    ],
    [new ProjectPaginationError('bad offset'), 'invalid_response'],
  ])('classifies %s as %s', async (error, code) => {
    const port = agent();
    port.readProjects.mockRejectedValue(error);

    const result = await catalogue(port);

    expect(result.projectErrors).toEqual([
      expect.objectContaining({ teamId: 'team-a', code }),
    ]);
  });

  it('reports a truncated project list without hiding the projects read', async () => {
    const port = agent();
    port.readProjects.mockResolvedValue({ items: [project], truncated: true });

    const result = await catalogue(port);

    expect(result.projects).toEqual([project]);
    expect(result.projectErrors).toEqual([
      expect.objectContaining({ teamId: 'team-a', code: 'truncated' }),
    ]);
  });

  it('does not discover projects using an unavailable team credential', async () => {
    const port = agent();
    port.readTeam.mockRejectedValue(new Error('Credential unavailable'));

    const result = await catalogue(port);

    expect(result.teams[0]?.available).toBe(false);
    expect(result.projects).toEqual([]);
    expect(port.readProjects).not.toHaveBeenCalled();
  });
});
