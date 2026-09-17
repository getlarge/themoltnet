import { KetoNamespace, type TeamRole } from '@moltnet/auth';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initTeamInviteWorkflow,
  type RedeemTeamInvite,
  setTeamInviteDeps,
  teamInviteWorkflow,
} from '../../src/workflows/team-invite-workflow.js';

const dbos = vi.hoisted(() => ({
  registerStep: vi.fn((fn: unknown) => fn),
  registerWorkflow: vi.fn((fn: unknown) => fn),
  startWorkflow: vi.fn(
    () => () =>
      Promise.resolve({
        getResult: () =>
          Promise.resolve({
            inviteId: 'invite',
            teamId: 'team',
            role: 'member',
          }),
      }),
  ),
  getWorkflowStatus: vi.fn(),
  retrieveWorkflow: vi.fn(() => ({
    getResult: () =>
      Promise.resolve({ inviteId: 'invite', teamId: 'team', role: 'manager' }),
  })),
}));
vi.mock('@moltnet/database', () => ({ DBOS: dbos }));

const input: RedeemTeamInvite = {
  inviteId: 'invite',
  subjectId: 'agent',
  subjectNs: KetoNamespace.Agent,
  enrollment: { idempotencyKey: 'request', codeHash: 'code-hash' },
};
const writer = {
  grantTeamManagers: vi.fn(),
  grantTeamExecutors: vi.fn(),
  grantTeamMembers: vi.fn(),
};
const reader = { listTeamMembers: vi.fn() };

beforeAll(() => initTeamInviteWorkflow());
beforeEach(() => {
  dbos.startWorkflow.mockClear();
  dbos.retrieveWorkflow.mockClear();
  for (const write of Object.values(writer)) write.mockClear();
  reader.listTeamMembers.mockResolvedValue([]);
  setTeamInviteDeps({
    relationshipReader: reader,
    relationshipWriter: writer,
  } as never);
});

function grantMembership() {
  return dbos.registerStep.mock.results[0].value as (
    input: RedeemTeamInvite,
    grant: { teamId: string; role: 'member' },
  ) => Promise<TeamRole>;
}

describe('invite workflow enrollment mode', () => {
  it.each([
    ['owners', 'owner'],
    ['managers', 'manager'],
    ['executors', 'executor'],
    ['members', 'member'],
  ])(
    'preserves the existing %s role for a fresh enrollment invite',
    async (relation, role) => {
      reader.listTeamMembers.mockResolvedValue([
        { subjectId: 'agent', subjectNs: 'Agent', relation },
      ]);
      expect(
        await grantMembership()(input, { teamId: 'team', role: 'member' }),
      ).toBe(role);
      for (const write of Object.values(writer))
        expect(write).not.toHaveBeenCalled();
    },
  );

  it('still changes roles for a normal membership-only join', async () => {
    reader.listTeamMembers.mockResolvedValue([
      { subjectId: 'agent', subjectNs: 'Agent', relation: 'managers' },
    ]);
    await grantMembership()(
      { ...input, enrollment: undefined },
      { teamId: 'team', role: 'member' },
    );
    expect(writer.grantTeamMembers).toHaveBeenCalledWith(
      'team',
      'agent',
      KetoNamespace.Agent,
    );
  });

  it('does not mistake a human role for the enrolling agent role', async () => {
    reader.listTeamMembers.mockResolvedValue([
      { subjectId: 'agent', subjectNs: 'Human', relation: 'owners' },
    ]);
    await grantMembership()(input, { teamId: 'team', role: 'member' });
    expect(writer.grantTeamMembers).toHaveBeenCalled();
  });

  it('keys enrollment execution by agent and request, independent of the invite', async () => {
    await teamInviteWorkflow.run(input);
    expect(dbos.startWorkflow).toHaveBeenCalledWith(expect.any(Function), {
      workflowID: 'team-enrollment:agent:request',
    });
  });

  it('loads a durable enrollment result through DBOS', async () => {
    dbos.getWorkflowStatus.mockResolvedValue({ status: 'SUCCESS' });
    expect(
      await teamInviteWorkflow.findEnrollment('agent', 'request'),
    ).toMatchObject({ role: 'manager' });
    expect(dbos.retrieveWorkflow).toHaveBeenCalledWith(
      'team-enrollment:agent:request',
    );
  });
});
