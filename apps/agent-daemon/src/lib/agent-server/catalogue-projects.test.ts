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
    readTeam: vi.fn(async (_teamId: string, _signal?: AbortSignal) => ({
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
    readProjects: vi.fn(async (_teamId: string, _signal?: AbortSignal) => ({
      items: [project],
      truncated: false,
    })),
    readProject: vi.fn(async () => project),
  } satisfies CatalogueAgentPort;
}
/** A read that ends only when aborted, like a request stuck in retry backoff. */
function untilAborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
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
    expect(port.readProjects).toHaveBeenCalledWith(
      'team-a',
      expect.any(AbortSignal),
    );
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

  it('reports a team that exceeds its budget as a timeout instead of hanging', async () => {
    // Arrange
    const port = agent();
    port.readTeam.mockImplementation((_teamId, signal) => untilAborted(signal));
    const logger = { warn: vi.fn() };

    // Act
    const result = await buildCatalogue({
      agent: port,
      machine,
      identityDefault: {},
      logger,
      teamBudgetMs: 20,
    });

    // Assert
    expect(result.teams[0]).toMatchObject({
      available: false,
      blockers: [
        expect.objectContaining({
          code: 'agent_key_unavailable',
          message: 'Verifying this team credential took too long.',
        }),
      ],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timedOut: true, teamId: 'team-a' }),
      'AgentServer team credential unavailable',
    );
  });

  it('keeps a verified team when only project discovery exceeds the budget', async () => {
    // Arrange
    const port = agent();
    port.readProjects.mockImplementation((_teamId, signal) =>
      untilAborted(signal),
    );

    // Act
    const result = await buildCatalogue({
      agent: port,
      machine,
      identityDefault: {},
      teamBudgetMs: 20,
    });

    // Assert
    expect(result.teams[0]?.available).toBe(true);
    expect(result.projectErrors).toEqual([
      expect.objectContaining({ teamId: 'team-a', code: 'unreachable' }),
    ]);
  });
});
