import type { CredentialEvidenceEvent } from '@themoltnet/credentials';
import { describe, expect, it, vi } from 'vitest';

import { createCredentialEvidenceSink } from './credential-evidence-sink.js';

const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TASK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const issued: CredentialEvidenceEvent = {
  version: 1,
  event: 'task_credential_issued',
  occurredAt: '2026-07-30T10:00:00.000Z',
  outcome: 'allow',
  reason: 'issued',
  agentId: AGENT_ID,
  teamId: TEAM_ID,
  taskId: TASK_ID,
  attemptN: 2,
  credentialJti: 'jti-1',
  credentialKid: 'active-key',
};

const denied: CredentialEvidenceEvent = {
  version: 1,
  event: 'task_credential_denied',
  occurredAt: '2026-07-30T10:00:00.000Z',
  outcome: 'deny',
  reason: 'lease_inactive',
  agentId: AGENT_ID,
  teamId: TEAM_ID,
  taskId: TASK_ID,
  attemptN: 2,
};

function sink(append = vi.fn().mockResolvedValue({ id: 'row-1' })) {
  const logger = { error: vi.fn() };
  return {
    append,
    logger,
    evidence: createCredentialEvidenceSink({ repository: { append }, logger }),
  };
}

describe('credential evidence sink', () => {
  it('persists an issuance event with every optional field normalized', async () => {
    const { append, evidence } = sink();

    await evidence.emit(issued);

    expect(append).toHaveBeenCalledWith({
      version: 1,
      event: 'task_credential_issued',
      occurredAt: new Date('2026-07-30T10:00:00.000Z'),
      outcome: 'allow',
      reason: 'issued',
      agentId: AGENT_ID,
      teamId: TEAM_ID,
      taskId: TASK_ID,
      attemptN: 2,
      connectorId: null,
      operation: null,
      resourceId: null,
      grantId: null,
      grantRevision: null,
      credentialJti: 'jti-1',
      credentialKid: 'active-key',
    });
  });

  it('persists a denial with its low-cardinality reason and no credential ids', async () => {
    const { append, evidence } = sink();

    await evidence.emit(denied);

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'task_credential_denied',
        outcome: 'deny',
        reason: 'lease_inactive',
        credentialJti: null,
        credentialKid: null,
      }),
    );
  });

  it('propagates a write failure so the broker can fail issuance closed', async () => {
    const failure = new Error('connection terminated');
    const { evidence, logger } = sink(vi.fn().mockRejectedValue(failure));

    await expect(evidence.emit(issued)).rejects.toBe(failure);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failure,
        event: 'task_credential_issued',
        outcome: 'allow',
      }),
      'credential.evidence_persist_failed',
    );
  });

  it.each([
    { name: 'an unknown event name', event: { ...issued, event: 'whatever' } },
    { name: 'an unknown outcome', event: { ...issued, outcome: 'maybe' } },
    { name: 'a contract version bump', event: { ...issued, version: 2 } },
    {
      name: 'an unexpected extra field',
      event: { ...issued, token: 'secret' },
    },
    { name: 'a missing reason', event: { ...issued, reason: undefined } },
    {
      name: 'an unparseable timestamp',
      event: { ...issued, occurredAt: '2026-13-45T99:00:00Z' },
    },
  ])('refuses to persist $name', async ({ event }) => {
    const { append, evidence, logger } = sink();

    await expect(
      evidence.emit(event as unknown as CredentialEvidenceEvent),
    ).rejects.toThrow(/Credential evidence event/);
    expect(append).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      'credential.evidence_event_invalid',
    );
  });
});
