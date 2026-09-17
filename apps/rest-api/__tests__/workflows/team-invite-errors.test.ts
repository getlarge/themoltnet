import { KetoNamespace } from '@moltnet/auth';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initTeamInviteWorkflow,
  setTeamInviteDeps,
  teamInviteWorkflow,
} from '../../src/workflows/team-invite-workflow.js';

const dbos = vi.hoisted(() => ({
  registerStep: vi.fn((fn: unknown) => fn),
  registerWorkflow: vi.fn((fn: unknown) => fn),
  startWorkflow: vi.fn(),
}));
vi.mock('@moltnet/database', () => ({ DBOS: dbos }));
const repository = {
  findInviteById: vi.fn(),
  findById: vi.fn(),
  claimInvite: vi.fn(),
};
const readMembers = vi.fn();
const input = {
  inviteId: 'invite',
  subjectId: 'subject',
  subjectNs: KetoNamespace.Human,
};

beforeAll(() => initTeamInviteWorkflow());
beforeEach(() => {
  vi.clearAllMocks();
  repository.findInviteById.mockResolvedValue({
    teamId: 'team',
    role: 'member',
    expiresAt: new Date('2099-01-01'),
  });
  repository.findById.mockResolvedValue({ personal: false, status: 'active' });
  repository.claimInvite.mockResolvedValue(null);
  setTeamInviteDeps({
    teamRepository: repository,
    transactionRunner: { runInTransaction: (fn: () => unknown) => fn() },
    relationshipReader: { listTeamMembers: readMembers },
    relationshipWriter: {},
  } as never);
  // JSON round-trip models a saved DBOS result, without Error prototypes.
  dbos.startWorkflow.mockImplementation(
    (fn: (value: typeof input) => Promise<unknown>) => (value: typeof input) =>
      Promise.resolve({
        getResult: async () => JSON.parse(JSON.stringify(await fn(value))),
      }),
  );
});

describe('durable invite rejections', () => {
  it.each([
    ['deleted', 404, 'NOT_FOUND'],
    ['human-executor', 403, 'FORBIDDEN'],
    ['expired', 410, 'INVITE_EXPIRED'],
    ['inactive', 400, 'TEAM_NOT_ACTIVE'],
    ['personal', 404, 'NOT_FOUND'],
    ['claim-lost', 410, 'INVITE_EXHAUSTED'],
  ])(
    'returns the problem for %s after DBOS serialization',
    async (scenario, statusCode, code) => {
      if (scenario === 'deleted')
        repository.findInviteById.mockResolvedValue(null);
      if (scenario === 'human-executor')
        repository.findInviteById.mockResolvedValue({ role: 'executor' });
      if (scenario === 'expired')
        repository.findInviteById.mockResolvedValue({
          role: 'member',
          expiresAt: new Date(0),
        });
      if (scenario === 'inactive')
        repository.findById.mockResolvedValue({ status: 'archived' });
      if (scenario === 'personal')
        repository.findById.mockResolvedValue({ personal: true });
      await expect(teamInviteWorkflow.run(input)).rejects.toMatchObject({
        statusCode,
        code,
      });
      expect(readMembers).not.toHaveBeenCalled();
      if (scenario !== 'claim-lost')
        expect(repository.claimInvite).not.toHaveBeenCalled();
    },
  );

  it('does not disguise an unexpected database failure as a spent invite', async () => {
    const failure = new Error('database unavailable');
    repository.findInviteById.mockRejectedValue(failure);
    await expect(teamInviteWorkflow.run(input)).rejects.toBe(failure);
    expect(readMembers).not.toHaveBeenCalled();
  });
});
