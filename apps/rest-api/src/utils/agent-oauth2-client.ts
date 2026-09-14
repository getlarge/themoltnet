import { AGENT_OAUTH_SCOPES } from '@moltnet/auth';
import type { OAuth2Client } from '@ory/client-fetch';

import { agentOAuth2ClientId } from './agent-oauth-client-id.js';

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
): OAuth2Client {
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
