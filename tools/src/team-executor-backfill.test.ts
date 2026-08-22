import { describe, expect, it, vi } from 'vitest';

import {
  backfillTeamExecutors,
  type TeamRoleRelation,
  type TeamRoleTuple,
} from './team-executor-backfill.js';

const PRESERVED_TEAM = '6743b4b1-6b93-46e2-a048-19490f04f91a';
const subject = (object: string, namespace = 'Agent') => ({
  namespace,
  object,
  relation: '',
});
const tuple = (
  object: string,
  relation: TeamRoleRelation,
  id: string,
  namespace = 'Agent',
): TeamRoleTuple => ({
  namespace: 'Team',
  object,
  relation,
  subject_set: subject(id, namespace),
});

describe('team executor backfill', () => {
  it('projects agent owners/managers and standalone executors idempotently without promoting members', async () => {
    const data: Record<TeamRoleRelation, TeamRoleTuple[]> = {
      owners: [tuple('team-1', 'owners', 'owner-agent')],
      managers: [tuple('team-1', 'managers', 'manager-agent')],
      executors: [tuple('team-2', 'executors', 'executor-agent')],
      members: [
        tuple(PRESERVED_TEAM, 'members', 'current-agent-1'),
        tuple(PRESERVED_TEAM, 'members', 'current-agent-2'),
      ],
    };
    const putTuple = vi.fn();

    const result = await backfillTeamExecutors(
      {
        listTuples: async ({ relation }) => ({ items: data[relation] }),
        putTuple,
      },
      'apply',
    );

    expect(result.inserted).toBe(3);
    expect(putTuple.mock.calls.map(([value]) => value)).toEqual([
      tuple('team-1', 'executors', 'owner-agent'),
      tuple('team-1', 'executors', 'manager-agent'),
      tuple('team-2', 'members', 'executor-agent'),
    ]);
    expect(JSON.stringify(putTuple.mock.calls)).not.toContain(PRESERVED_TEAM);
  });

  it('is a no-op when projections already exist', async () => {
    const data: Record<TeamRoleRelation, TeamRoleTuple[]> = {
      owners: [tuple('team-1', 'owners', 'owner-agent')],
      managers: [],
      executors: [tuple('team-1', 'executors', 'owner-agent')],
      members: [],
    };
    const putTuple = vi.fn();

    const result = await backfillTeamExecutors(
      {
        listTuples: async ({ relation }) => ({ items: data[relation] }),
        putTuple,
      },
      'apply',
    );

    expect(result.inserted).toBe(0);
    expect(putTuple).not.toHaveBeenCalled();
  });

  it('reports missing projections without writing in dry-run mode', async () => {
    const putTuple = vi.fn();

    const result = await backfillTeamExecutors(
      {
        listTuples: async ({ relation }) => ({
          items:
            relation === 'owners'
              ? [tuple('team-1', 'owners', 'owner-agent')]
              : [],
        }),
        putTuple,
      },
      'dry-run',
    );

    expect(result.inserted).toBe(0);
    expect(result.missing).toEqual([
      tuple('team-1', 'executors', 'owner-agent'),
    ]);
    expect(putTuple).not.toHaveBeenCalled();
  });

  it('rejects verify mode when a projection is missing', async () => {
    await expect(
      backfillTeamExecutors(
        {
          listTuples: async ({ relation }) => ({
            items:
              relation === 'owners'
                ? [tuple('team-1', 'owners', 'owner-agent')]
                : [],
          }),
          putTuple: vi.fn(),
        },
        'verify',
      ),
    ).rejects.toThrow('1 tuple(s) missing');
  });
});
