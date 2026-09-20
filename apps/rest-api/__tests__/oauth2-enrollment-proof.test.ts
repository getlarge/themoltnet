import {
  AGENT_OAUTH_SCOPES,
  type OryClients,
  PROVISIONING_SCOPE,
} from '@moltnet/auth';
import { cryptoService, enrollmentProofMessage } from '@moltnet/crypto-service';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockServices, createTestApp } from './helpers.js';

const { issue } = vi.hoisted(() => ({ issue: vi.fn() }));
vi.mock('@moltnet/agent-key-service', async (original) => ({
  ...(await original<typeof import('@moltnet/agent-key-service')>()),
  createAgentKeyService: () => ({ issue }),
}));
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const app of apps.splice(0)) await app.close();
});
const grant = {
  agentId: 'aaaaaaaa-0000-4000-8000-000000000001',
  teamId: 'bbbbbbbb-0000-4000-8000-000000000002',
  operation: 'enroll' as const,
  scopes: ['task:execute'],
  idempotencyKey: 'proof-request',
};
async function setup() {
  vi.stubEnv('MOLTNET_NATIVE_OAUTH_CLIENT_ID', 'native');
  const keys = await cryptoService.generateKeyPair();
  const mocks = createMockServices();
  mocks.permissionChecker.canManageTeamCredentials.mockResolvedValue(true);
  mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(true);
  mocks.relationshipReader.isTeamMember.mockResolvedValue(false);
  mocks.agentRepository.findById.mockResolvedValue({
    id: grant.agentId,
    identityId: 'identity',
    publicKey: keys.publicKey,
  } as never);
  mocks.teamRepository.findById.mockResolvedValue({
    id: grant.teamId,
    personal: false,
    status: 'active',
    name: 'Team',
  } as never);
  const patchRelationships = vi.fn().mockResolvedValue(undefined);
  const app = await createTestApp(
    mocks,
    {
      subjectType: 'human',
      humanId: 'cccccccc-0000-4000-8000-000000000003',
      identityId: 'dddddddd-0000-4000-8000-000000000004',
      clientId: 'native',
      currentTeamId: null,
      scopes: [PROVISIONING_SCOPE],
      provisioning: grant,
      delegableScopes: [...AGENT_OAUTH_SCOPES],
    },
    undefined,
    {
      relationshipApi: {
        patchRelationships,
      } as unknown as OryClients['relationship'],
    },
  );
  apps.push(app);
  return { app, keys, patchRelationships };
}
describe('enrollment target proof', () => {
  it('requires a matching identity proof before membership or key issuance', async () => {
    const { app, keys, patchRelationships } = await setup();
    const wrong = await cryptoService.generateKeyPair();
    const message = enrollmentProofMessage({
      accessToken: 'approved-token',
      grant,
    });
    for (const payload of [
      {},
      { agentProof: await cryptoService.sign(message, wrong.privateKey) },
      {
        agentProof: await cryptoService.sign(
          enrollmentProofMessage({ accessToken: 'different-token', grant }),
          keys.privateKey,
        ),
      },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/oauth2/provision',
        headers: { authorization: 'Bearer approved-token' },
        payload,
      });
      expect(response.statusCode).toBe(403);
    }
    expect(patchRelationships).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
    issue.mockResolvedValueOnce({
      key: {
        id: 'key',
        agentId: grant.agentId,
        bindingScope: 'team',
        teamId: grant.teamId,
        name: 'Desktop team credential',
        scopes: grant.scopes,
        status: 'active',
        createdAt: null,
        expiresAt: null,
        lastUsedAt: null,
        updatedAt: null,
        revocationReason: null,
        revocationDescription: null,
      },
      secret: 'issued-secret',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/oauth2/provision',
      headers: { authorization: 'Bearer approved-token' },
      payload: {
        agentProof: await cryptoService.sign(message, keys.privateKey),
      },
    });
    expect(response.statusCode).toBe(201);
    expect(patchRelationships).toHaveBeenCalledOnce();
    expect(issue).toHaveBeenCalledOnce();
  });
});
