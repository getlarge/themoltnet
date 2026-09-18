import { describe, expect, it } from 'vitest';

import {
  buildCatalogue,
  type CatalogueAgentPort,
  type CatalogueDiaryRecord,
  type CatalogueProfileRecord,
} from './catalogue.js';

const TEAM_A = '4f2a91c8-1d3e-4b77-9a02-6c1b8e7d5a40';
const TEAM_B = 'b83c0d16-7e54-4a91-8f22-0d95c4e61b38';

const credential = {
  keyId: 'key-1',
  expiresAt: null,
  verifiedAt: '2026-09-18T12:00:00.000Z',
  scopes: ['team:read', 'diary:read'],
};
function port(
  overrides: {
    listDiaries?: () => Promise<CatalogueDiaryRecord[]>;
    teamIds?: string[];
  } = {},
): CatalogueAgentPort {
  const data = {
    listTeams: () =>
      Promise.resolve([
        { id: TEAM_A, name: 'MoltNet Core', personal: false },
        { id: TEAM_B, name: 'Clairon Pilot', personal: false },
      ]),
    listDiaries: () =>
      Promise.resolve([
        { id: 'diary-a', name: 'themoltnet', teamId: TEAM_A },
        { id: 'diary-b', name: 'clairon', teamId: TEAM_B },
      ]),
    listProfiles: (teamId: string): Promise<CatalogueProfileRecord[]> =>
      Promise.resolve(
        teamId === TEAM_A
          ? [
              {
                id: 'profile-1',
                name: 'opus-review',
                teamId: TEAM_A,
                description: 'Deep review with an enforced tool policy.',
                provider: 'anthropic',
                model: 'claude-opus-5',
                runtimeKind: 'gondolin_pi',
                toolEnforcement: 'enforce',
                defaultWorkspaceMode: 'dedicated_worktree',
                maxTurns: 40,
                revision: 7,
                definitionCid: 'bafyreih5k2qz7x4m9wnd3tvu6ge8sc1prbjyloa',
                requiredEnv: ['ANTHROPIC_API_KEY'],
                requiredTools: [],
                requiredExecutables: [],
              },
            ]
          : [],
      ),
    ...overrides,
  };
  return {
    teamIds: overrides.teamIds ?? [TEAM_A, TEAM_B],
    lastVerified: () => credential,
    readTeam: async (teamId) => ({
      team: (await data.listTeams()).find((team) => team.id === teamId)!,
      diaries: await data.listDiaries(),
      profiles: await data.listProfiles(teamId),
      credential,
    }),
  };
}

const machine = {
  providerEnv: new Map([['ANTHROPIC_API_KEY', true]]),
  runtimeKinds: new Set(['gondolin_pi']),
};

describe('buildCatalogue', () => {
  it('pairs each team with its diary', async () => {
    // Act
    const catalogue = await buildCatalogue({
      agent: port(),
      machine,
      identityDefault: {},
    });

    // Assert
    expect(catalogue.teams).toEqual([
      {
        teamId: TEAM_A,
        teamName: 'MoltNet Core',
        available: true,
        blockers: [],
        credential,
        diaries: [{ id: 'diary-a', name: 'themoltnet' }],
        defaultDiaryId: 'diary-a',
      },
      {
        teamId: TEAM_B,
        teamName: 'Clairon Pilot',
        available: true,
        blockers: [],
        credential,
        diaries: [{ id: 'diary-b', name: 'clairon' }],
        defaultDiaryId: 'diary-b',
      },
    ]);
  });

  it('leaves the diary unresolved when a team has several', async () => {
    // The CLI makes the operator choose the pair; the desktop must too rather
    // than guessing which diary a run writes to.
    const catalogue = await buildCatalogue({
      agent: port({
        listDiaries: () =>
          Promise.resolve([
            { id: 'diary-a', name: 'themoltnet', teamId: TEAM_A },
            { id: 'diary-a2', name: 'scratch', teamId: TEAM_A },
          ]),
      }),
      machine,
      identityDefault: {},
    });

    const teamA = catalogue.teams.find((team) => team.teamId === TEAM_A);
    expect(teamA?.diaries).toHaveLength(2);
    expect(teamA?.defaultDiaryId).toBeNull();
  });

  it('prefers the identity default diary when it belongs to that team', async () => {
    // Arrange
    const catalogue = await buildCatalogue({
      agent: port({
        listDiaries: () =>
          Promise.resolve([
            { id: 'diary-a', name: 'themoltnet', teamId: TEAM_A },
            { id: 'diary-a2', name: 'scratch', teamId: TEAM_A },
          ]),
      }),
      machine,
      identityDefault: { teamId: TEAM_A, diaryId: 'diary-a2' },
    });

    // Assert
    const teamA = catalogue.teams.find((team) => team.teamId === TEAM_A);
    expect(teamA?.defaultDiaryId).toBe('diary-a2');
  });

  it('ignores an identity default diary belonging to another team', async () => {
    // A stale binding must not pair team B with team A's diary — the exact
    // drift the paired run spec exists to prevent.
    const catalogue = await buildCatalogue({
      agent: port(),
      machine,
      identityDefault: { teamId: TEAM_A, diaryId: 'diary-a' },
    });

    const teamB = catalogue.teams.find((team) => team.teamId === TEAM_B);
    expect(teamB?.defaultDiaryId).toBe('diary-b');
  });

  it('seeds the default team from the identity binding', async () => {
    // Act
    const catalogue = await buildCatalogue({
      agent: port(),
      machine,
      identityDefault: { teamId: TEAM_B, diaryId: 'diary-b' },
    });

    // Assert
    expect(catalogue.defaultTeamId).toBe(TEAM_B);
  });

  it('falls back to the first team when the identity default is unknown', async () => {
    // Arrange: a binding pointing at a team this identity cannot serve.
    const catalogue = await buildCatalogue({
      agent: port(),
      machine,
      identityDefault: { teamId: 'team-that-is-gone', diaryId: 'd' },
    });

    // Assert
    expect(catalogue.defaultTeamId).toBe(TEAM_A);
  });

  it('attaches machine readiness to every profile', async () => {
    // Act
    const catalogue = await buildCatalogue({
      agent: port(),
      machine,
      identityDefault: {},
    });

    // Assert
    const profile = catalogue.profiles.find((p) => p.name === 'opus-review');
    expect(profile?.ready).toBe(true);
    expect(profile?.blockers).toEqual([]);
    // The composer shows what the run will execute under, so the policy
    // fields must survive the catalogue rather than being narrowed away.
    expect(profile?.provider).toBe('anthropic');
    expect(profile?.model).toBe('claude-opus-5');
    expect(profile?.toolEnforcement).toBe('enforce');
    expect(profile?.maxTurns).toBe(40);
    expect(profile?.revision).toBe(7);
  });

  it('marks a profile unready when this machine lacks its provider key', async () => {
    // Arrange
    const catalogue = await buildCatalogue({
      agent: port(),
      machine: {
        providerEnv: new Map(),
        runtimeKinds: new Set(['gondolin_pi']),
      },
      identityDefault: {},
    });

    // Assert
    const profile = catalogue.profiles.find((p) => p.name === 'opus-review');
    expect(profile?.ready).toBe(false);
    expect(profile?.blockers[0]?.code).toBe('env_missing');
  });

  it('returns no teams when the identity belongs to none', async () => {
    // The desktop shows an empty state pointing at Console to enrol one.
    const catalogue = await buildCatalogue({
      agent: port({
        teamIds: [],
        listDiaries: () => Promise.resolve([]),
      }),
      machine,
      identityDefault: {},
    });

    expect(catalogue.teams).toEqual([]);
    expect(catalogue.defaultTeamId).toBeNull();
    expect(catalogue.profiles).toEqual([]);
  });
  it('keeps usable B and cached A metadata when A fails without leaking upstream errors', async () => {
    const agent = port();
    const readTeam = agent.readTeam;
    agent.readTeam = (teamId) =>
      teamId === TEAM_A
        ? Promise.reject(
            Object.assign(new Error('secret-sentinel'), { statusCode: 403 }),
          )
        : readTeam(teamId);
    const result = await buildCatalogue({
      agent,
      machine,
      identityDefault: { teamId: TEAM_A },
    });
    expect(result.defaultTeamId).toBe(TEAM_B);
    expect(result.teams[0]).toMatchObject({
      available: false,
      credential,
      diaries: [],
      blockers: [{ code: 'agent_key_unavailable' }],
    });
    expect(result.teams[1]?.available).toBe(true);
    expect(result.profiles).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('secret-sentinel');
  });
});
