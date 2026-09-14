import { AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import type { OAuth2Api, OAuth2Client } from '@ory/client-fetch';

import { upstreamStatus } from './upstream-status.js';

/**
 * Deterministic OAuth2 client ID for an agent.
 *
 * Derived from the agent's INTERNAL id, never from its Kratos identity. A
 * Kratos identity can be recreated (see the 2026-09-04 incident), and when it
 * is, an identity-derived client ID silently stops resolving — credential
 * recovery then looks up a client that does not exist. `agents.id` is
 * immutable, so the derivation is stable for the life of the agent.
 */
export function agentOAuth2ClientId(agentId: string): string {
  return `moltnet-agent-${agentId}`;
}

export interface AgentOAuth2ClientInput {
  /** Durable `agents.id`; the token webhook looks clients up by it. */
  agentId: string;
  /** Kratos binding, retained for compatibility; may be absent after a relink. */
  identityId: string | null;
  publicKey: string;
  fingerprint: string;
  clientSecret: string;
}

/**
 * The one Hydra client shape MoltNet issues to an agent. Registration creates
 * it; credential recovery re-creates it when it is missing. Keeping the body
 * in one place means both paths mint a client the token webhook recognises.
 */
export function buildAgentOAuth2Client(
  input: AgentOAuth2ClientInput,
): OAuth2Client & { client_id: string } {
  return {
    client_id: agentOAuth2ClientId(input.agentId),
    client_secret: input.clientSecret,
    client_name: `Agent: ${input.fingerprint}`,
    grant_types: ['client_credentials'],
    response_types: [],
    token_endpoint_auth_method: 'client_secret_post',
    scope: AGENT_OAUTH_SCOPES.join(' '),
    metadata: {
      type: 'moltnet_agent',
      agent_id: input.agentId,
      ...(input.identityId ? { identity_id: input.identityId } : {}),
      public_key: input.publicKey,
      fingerprint: input.fingerprint,
    },
  };
}

/**
 * Idempotent write of an agent's deterministic client: create it, and replace
 * it when it already exists. A create can commit in Hydra while its response
 * is lost, and a concurrent recovery can create the same id between a lookup
 * and this write; both land on the replace. The last write wins, so the
 * secret passed here is the one that authenticates afterwards.
 */
export async function createOrReplaceAgentOAuth2Client(
  oauth2Api: Pick<OAuth2Api, 'createOAuth2Client' | 'setOAuth2Client'>,
  oAuth2Client: OAuth2Client & { client_id: string },
): Promise<void> {
  try {
    await oauth2Api.createOAuth2Client({ oAuth2Client });
  } catch (error) {
    if (upstreamStatus(error) !== 409) throw error;
    await oauth2Api.setOAuth2Client({
      id: oAuth2Client.client_id,
      oAuth2Client,
    });
  }
}
