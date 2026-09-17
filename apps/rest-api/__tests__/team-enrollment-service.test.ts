import { createHash } from 'node:crypto';

import type { AgentKeyService } from '@moltnet/agent-key-service';
import { KetoNamespace } from '@moltnet/auth';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProblem } from '../src/problems/index.js';
import { enrollTeamAgent } from '../src/services/team-enrollment.service.js';
import { teamInviteWorkflow } from '../src/workflows/team-invite-workflow.js';

vi.mock('../src/workflows/team-invite-workflow.js', () => ({
  teamInviteWorkflow: { findEnrollment: vi.fn(), run: vi.fn() },
}));

const code = 'mlt_inv_test';
const grant = {
  inviteId: 'invite-1',
  teamId: 'team-1',
  role: 'member' as const,
  enrollmentCodeHash: createHash('sha256').update(code).digest('hex'),
};
const input = {
  subjectId: 'agent-1',
  subjectNs: KetoNamespace.Agent,
  code,
  idempotencyKey: 'request-1',
  signal: new AbortController().signal,
};
const teamRepository = { findInviteByCode: vi.fn(), findById: vi.fn() };
const keys = { issueEnrollment: vi.fn() };
const app = { teamRepository, log: {} } as unknown as FastifyInstance;
const enroll = (overrides = {}) =>
  enrollTeamAgent(app, keys as unknown as AgentKeyService, {
    ...input,
    ...overrides,
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(teamInviteWorkflow.findEnrollment).mockResolvedValue(null);
  vi.mocked(teamInviteWorkflow.run).mockResolvedValue(grant);
  teamRepository.findInviteByCode.mockResolvedValue({
    id: grant.inviteId,
    teamId: grant.teamId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  teamRepository.findById.mockResolvedValue({
    id: grant.teamId,
    personal: false,
    status: 'active',
  });
  keys.issueEnrollment.mockResolvedValue({
    key: { id: 'key-1' },
    secret: 'one-time-secret',
  });
});

describe('team enrollment request', () => {
  it('uses the invite workflow and passes only its grant to Talos issuance', async () => {
    expect(await enroll()).toMatchObject({
      teamId: grant.teamId,
      role: 'member',
      agentKey: { secret: 'one-time-secret' },
    });
    expect(teamInviteWorkflow.run).toHaveBeenCalledWith({
      inviteId: grant.inviteId,
      subjectId: input.subjectId,
      subjectNs: KetoNamespace.Agent,
      enrollment: {
        idempotencyKey: input.idempotencyKey,
        codeHash: grant.enrollmentCodeHash,
      },
    });
    expect(keys.issueEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        grant: {
          inviteId: grant.inviteId,
          agentId: input.subjectId,
          teamId: grant.teamId,
        },
      }),
    );
    expect(
      JSON.stringify(vi.mocked(teamInviteWorkflow.run).mock.calls),
    ).not.toContain(code);
    expect(
      JSON.stringify(vi.mocked(teamInviteWorkflow.run).mock.calls),
    ).not.toContain('one-time-secret');
  });

  it.each([
    [{ subjectNs: KetoNamespace.Human }, 403],
    [{ idempotencyKey: undefined }, 400],
    [{ idempotencyKey: ' ' }, 400],
  ])(
    'rejects invalid enrollment authorization before reading or consuming an invite',
    async (overrides, statusCode) => {
      await expect(enroll(overrides)).rejects.toMatchObject({ statusCode });
      expect(teamRepository.findInviteByCode).not.toHaveBeenCalled();
      expect(teamInviteWorkflow.run).not.toHaveBeenCalled();
      expect(keys.issueEnrollment).not.toHaveBeenCalled();
    },
  );

  it('resumes from DBOS after the invitation is deleted without claiming again', async () => {
    vi.mocked(teamInviteWorkflow.findEnrollment).mockResolvedValue(grant);
    teamRepository.findInviteByCode.mockResolvedValue(null);
    expect(await enroll()).toMatchObject({ teamId: grant.teamId });
    expect(teamRepository.findInviteByCode).not.toHaveBeenCalled();
    expect(teamInviteWorkflow.run).not.toHaveBeenCalled();
  });

  it.each(['findEnrollment', 'run'] as const)(
    'rejects changed input when %s returns the original DBOS result',
    async (method) => {
      vi.mocked(teamInviteWorkflow[method]).mockResolvedValue({
        ...grant,
        enrollmentCodeHash: 'another-code',
      });
      await expect(enroll()).rejects.toMatchObject({ statusCode: 409 });
      expect(keys.issueEnrollment).not.toHaveBeenCalled();
    },
  );

  it('returns conflict when Talos omits the previously issued secret', async () => {
    vi.mocked(teamInviteWorkflow.findEnrollment).mockResolvedValue(grant);
    keys.issueEnrollment.mockResolvedValue({ key: { id: 'key-1' } });
    await expect(enroll()).rejects.toMatchObject({ statusCode: 409 });
    expect(teamInviteWorkflow.run).not.toHaveBeenCalled();
  });

  it('checks team status again before issuing from a saved grant', async () => {
    vi.mocked(teamInviteWorkflow.findEnrollment).mockResolvedValue(grant);
    teamRepository.findById.mockResolvedValue({ status: 'archived' });
    await expect(enroll()).rejects.toMatchObject({ statusCode: 400 });
    expect(keys.issueEnrollment).not.toHaveBeenCalled();
  });

  it('maps an atomic claim loss to an exhausted invite without issuing', async () => {
    vi.mocked(teamInviteWorkflow.run).mockRejectedValue(
      createProblem('invite-exhausted'),
    );
    await expect(enroll()).rejects.toMatchObject({ statusCode: 410 });
    expect(keys.issueEnrollment).not.toHaveBeenCalled();
  });
});
