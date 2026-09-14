import { AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import { describe, expect, it, vi } from 'vitest';

import {
  agentOAuth2ClientId,
  buildAgentOAuth2Client,
  createOrReplaceAgentOAuth2Client,
} from '../src/utils/agent-oauth2-client.js';

describe('buildAgentOAuth2Client', () => {
  const input = {
    agentId: '11111111-1111-4111-8111-111111111111',
    identityId: '22222222-2222-4222-8222-222222222222',
    publicKey: 'ed25519:AAAA+/bbbb==',
    fingerprint: 'ABCD-EF01-2345-6789',
    clientSecret: 'secret-value',
  };

  it('builds the client_credentials client keyed by the durable agent id', () => {
    const client = buildAgentOAuth2Client(input);

    expect(client).toEqual({
      client_id: agentOAuth2ClientId(input.agentId),
      client_secret: 'secret-value',
      client_name: `Agent: ${input.fingerprint}`,
      grant_types: ['client_credentials'],
      response_types: [],
      token_endpoint_auth_method: 'client_secret_post',
      scope: AGENT_OAUTH_SCOPES.join(' '),
      metadata: {
        type: 'moltnet_agent',
        agent_id: input.agentId,
        identity_id: input.identityId,
        public_key: input.publicKey,
        fingerprint: input.fingerprint,
      },
    });
  });

  it('omits identity_id when the agent has no bound Ory identity', () => {
    const client = buildAgentOAuth2Client({ ...input, identityId: null });

    expect(client.metadata).not.toHaveProperty('identity_id');
    expect(client.metadata).toMatchObject({ agent_id: input.agentId });
  });
});

describe('createOrReplaceAgentOAuth2Client', () => {
  const client = buildAgentOAuth2Client({
    agentId: '11111111-1111-4111-8111-111111111111',
    identityId: null,
    publicKey: 'ed25519:AAAA+/bbbb==',
    fingerprint: 'ABCD-EF01-2345-6789',
    clientSecret: 'secret-value',
  });
  const withStatus = (status: number) =>
    Object.assign(new Error(`status ${status}`), { response: { status } });

  it('creates the client when it does not exist', async () => {
    const api = {
      createOAuth2Client: vi.fn().mockResolvedValue(undefined),
      setOAuth2Client: vi.fn(),
    };

    await createOrReplaceAgentOAuth2Client(api as never, client);

    expect(api.createOAuth2Client).toHaveBeenCalledWith({
      oAuth2Client: client,
    });
    expect(api.setOAuth2Client).not.toHaveBeenCalled();
  });

  it('replaces the client with the same body on a conflict', async () => {
    const api = {
      createOAuth2Client: vi.fn().mockRejectedValue(withStatus(409)),
      setOAuth2Client: vi.fn().mockResolvedValue(undefined),
    };

    await createOrReplaceAgentOAuth2Client(api as never, client);

    expect(api.setOAuth2Client).toHaveBeenCalledWith({
      id: client.client_id,
      oAuth2Client: client,
    });
  });

  it('rethrows any other upstream failure without replacing', async () => {
    const failure = withStatus(503);
    const api = {
      createOAuth2Client: vi.fn().mockRejectedValue(failure),
      setOAuth2Client: vi.fn(),
    };

    await expect(
      createOrReplaceAgentOAuth2Client(api as never, client),
    ).rejects.toBe(failure);
    expect(api.setOAuth2Client).not.toHaveBeenCalled();
  });
});
