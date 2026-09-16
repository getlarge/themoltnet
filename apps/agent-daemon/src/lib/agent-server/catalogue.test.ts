import { describe, expect, it } from 'vitest';

import { buildCatalogue, type CatalogueAgentPort } from './catalogue.js';

const TEAM_A = '4f2a91c8-1d3e-4b77-9a02-6c1b8e7d5a40';
const TEAM_B = 'b83c0d16-7e54-4a91-8f22-0d95c4e61b38';

function port(overrides: Partial<CatalogueAgentPort> = {}): CatalogueAgentPort {
  return {
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
    listProfiles: (teamId) =>
      Promise.resolve(
        teamId === TEAM_A
          ? [
              {
                id: 'profile-1',
                name: 'opus-review',
                teamId: TEAM_A,
                runtimeKind: 'gondolin_pi',
                requiredEnv: ['ANTHROPIC_API_KEY'],
                requiredExecutables: [],
              },
            ]
          : [],
      ),
    ...overrides,
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
        diaries: [{ id: 'diary-a', name: 'themoltnet' }],
        defaultDiaryId: 'diary-a',
      },
      {
        teamId: TEAM_B,
        teamName: 'Clairon Pilot',
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
  });

  it('marks a profile unready when this machine lacks its provider key', async () => {
    // Arrange
    const catalogue = await buildCatalogue({
      agent: port(),
      machine: { providerEnv: new Map(), runtimeKinds: new Set(['gondolin_pi']) },
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
        listTeams: () => Promise.resolve([]),
        listDiaries: () => Promise.resolve([]),
      }),
      machine,
      identityDefault: {},
    });

    expect(catalogue.teams).toEqual([]);
    expect(catalogue.defaultTeamId).toBeNull();
    expect(catalogue.profiles).toEqual([]);
  });
});
