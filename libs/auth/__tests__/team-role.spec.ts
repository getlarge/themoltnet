import { describe, expect, it } from 'vitest';

import { TeamRelation } from '../src/keto-constants.js';
import {
  highestTeamRole,
  normalizeTeamRelation,
  TEAM_ROLE,
  teamRelationToRole,
  teamRoleRank,
  teamRoleToRelation,
} from '../src/team-role.js';

describe('team roles', () => {
  it('maps the executor role and relation in both directions', () => {
    expect(teamRelationToRole(TeamRelation.Executors)).toBe(TEAM_ROLE.Executor);
    expect(teamRoleToRelation(TEAM_ROLE.Executor)).toBe(TeamRelation.Executors);
    expect(normalizeTeamRelation('executors')).toBe(TeamRelation.Executors);
  });

  it('uses owner > manager > executor > member precedence', () => {
    expect(teamRoleRank(TEAM_ROLE.Owner)).toBeGreaterThan(
      teamRoleRank(TEAM_ROLE.Manager),
    );
    expect(teamRoleRank(TEAM_ROLE.Manager)).toBeGreaterThan(
      teamRoleRank(TEAM_ROLE.Executor),
    );
    expect(teamRoleRank(TEAM_ROLE.Executor)).toBeGreaterThan(
      teamRoleRank(TEAM_ROLE.Member),
    );
    expect(
      highestTeamRole([
        TEAM_ROLE.Member,
        TEAM_ROLE.Executor,
        TEAM_ROLE.Manager,
      ]),
    ).toBe(TEAM_ROLE.Manager);
  });
});
