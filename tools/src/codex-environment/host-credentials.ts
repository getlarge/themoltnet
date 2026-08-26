import {
  defineHostCapability,
  type HostCapabilityContext,
} from '@themoltnet/agent-runtime';
import type { MoltNetConfig } from '@themoltnet/sdk';
import { Type } from 'typebox';

import {
  classifyCredentialPreflight,
  type CredentialPreflightReason,
} from './contracts.js';

/** Verify that the released CLI brokered the configured binding into the host. */
export function preflightBrokeredHostCredential(
  config: MoltNetConfig,
  environment: NodeJS.ProcessEnv,
): CredentialPreflightReason {
  const hasBinding =
    ('client_secret' in config.oauth2 &&
      Boolean(config.oauth2.client_secret)) ||
    Boolean(config.oauth2.client_secret_ref);
  if (!hasBinding) return 'required_binding_missing';

  const deliveredClientId = environment.MOLTNET_CLIENT_ID?.trim();
  if (
    deliveredClientId &&
    deliveredClientId !== config.oauth2.client_id.trim()
  ) {
    return 'binding_requirement_mismatch';
  }
  const deliveredSecret = environment.MOLTNET_CLIENT_SECRET?.trim();
  if (!deliveredClientId || !deliveredSecret) return 'delivery_failed';

  return classifyCredentialPreflight({
    binding: 'present',
    requirementMatches: true,
    resolutionBoundary: 'trusted-host',
    destinationAllowed: true,
    providerAvailable: true,
    providerRead: 'succeeded',
    valueFound: true,
    delivery: 'succeeded',
  });
}

/** Keep launch-only MoltNet credentials out of the host Codex subprocess. */
export function withoutBrokeredMoltNetSecrets(
  environment: NodeJS.ProcessEnv,
  brokeredClientSecret: string,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) =>
        name !== 'MOLTNET_AGENT_KEY' &&
        !(name.endsWith('_CLIENT_SECRET') && value === brokeredClientSecret),
    ),
  );
}

/**
 * Probe-only capability proving that guest code can request an authenticated
 * host operation without receiving the host credential or identity fields.
 */
export const hostAuthenticationCapability = defineHostCapability({
  name: 'host-auth-check',
  operations: {
    whoami: {
      request: Type.Object({}, { additionalProperties: false }),
      response: Type.Object(
        {
          authenticated: Type.Literal(true),
          agentSubject: Type.Boolean(),
          identityMatched: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      async handle(
        _input: Record<string, never>,
        context: HostCapabilityContext,
      ) {
        const whoami = await context.agent.agents.whoami();
        return {
          authenticated: true as const,
          agentSubject: whoami.subjectType === 'agent',
          identityMatched:
            whoami.identityId === context.identity.identityId &&
            whoami.publicKey === context.identity.publicKey &&
            whoami.fingerprint === context.identity.fingerprint,
        };
      },
      evidence: () => ({ responseShape: 'boolean-only' }),
    },
  },
});
