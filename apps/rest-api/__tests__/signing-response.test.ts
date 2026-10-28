import type { SigningRequest } from '@moltnet/database';
import { describe, expect, it, vi } from 'vitest';

import { toSigningResponses } from '../src/utils/signing-response.js';

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const HUMAN_ID = '660e8400-e29b-41d4-a716-446655440001';

const row = (requester: {
  requesterAgentId: string | null;
  requesterHumanId: string | null;
}) =>
  ({
    id: '770e8400-e29b-41d4-a716-446655440002',
    message: 'message',
    nonce: '880e8400-e29b-41d4-a716-446655440003',
    ...requester,
  }) as SigningRequest;

const deps = () => ({
  agentRepository: {
    findByIds: vi.fn().mockResolvedValue(
      new Map([
        [
          AGENT_ID,
          {
            id: AGENT_ID,
            identityId: null,
            fingerprint: 'AAAA-BBBB-CCCC-DDDD',
            publicKey: 'ed25519:a2V5',
          },
        ],
      ]),
    ),
  },
  humanRepository: {
    findByIds: vi
      .fn()
      .mockResolvedValue(
        new Map([[HUMAN_ID, { id: HUMAN_ID, identityId: null }]]),
      ),
  },
});

describe('toSigningResponses', () => {
  it('resolves agent and human requesters with one lookup per kind', async () => {
    const d = deps();

    const [agent, human] = await toSigningResponses(
      [
        row({ requesterAgentId: AGENT_ID, requesterHumanId: null }),
        row({ requesterAgentId: null, requesterHumanId: HUMAN_ID }),
      ],
      d as never,
    );

    expect(agent.requestedBy).toEqual({
      kind: 'agent',
      agentId: AGENT_ID,
      identityId: null,
      fingerprint: 'AAAA-BBBB-CCCC-DDDD',
      publicKey: 'ed25519:a2V5',
    });
    expect(human.requestedBy).toEqual({
      kind: 'human',
      humanId: HUMAN_ID,
      identityId: null,
    });
    expect(d.agentRepository.findByIds).toHaveBeenCalledWith([AGENT_ID]);
    expect(d.humanRepository.findByIds).toHaveBeenCalledWith([HUMAN_ID]);
  });

  it('fails when a requester row is gone', async () => {
    const d = deps();
    d.humanRepository.findByIds.mockResolvedValue(new Map());

    await expect(
      toSigningResponses(
        [row({ requesterAgentId: null, requesterHumanId: HUMAN_ID })],
        d as never,
      ),
    ).rejects.toMatchObject({ code: 'PRINCIPAL_HUMAN_NOT_FOUND' });
  });
});
