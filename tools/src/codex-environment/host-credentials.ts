import {
  defineHostCapability,
  type HostCapabilityContext,
} from '@themoltnet/agent-runtime';
import type { MoltNetConfig, SecretProviderRegistry } from '@themoltnet/sdk';
import { Type } from 'typebox';

import {
  classifyCredentialPreflight,
  type CredentialPreflightReason,
} from './contracts.js';

/** Resolve only enough host-store state to classify the credential boundary. */
export async function preflightHostCredential(
  config: MoltNetConfig,
  providers: SecretProviderRegistry,
): Promise<CredentialPreflightReason> {
  if ('client_secret' in config.oauth2 && config.oauth2.client_secret) {
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
  const reference = config.oauth2.client_secret_ref;
  if (!reference) return 'required_binding_missing';
  const provider = providers.get(reference.provider);
  if (!provider) {
    return classifyCredentialPreflight({
      binding: 'present',
      requirementMatches: true,
      resolutionBoundary: 'trusted-host',
      destinationAllowed: true,
      providerAvailable: false,
    });
  }
  try {
    const value = await provider.read(reference.key);
    return classifyCredentialPreflight({
      binding: 'present',
      requirementMatches: true,
      resolutionBoundary: 'trusted-host',
      destinationAllowed: true,
      providerAvailable: true,
      providerRead: 'succeeded',
      valueFound: value !== null && value !== '',
      ...(value !== null && value !== '' && { delivery: 'succeeded' }),
    });
  } catch {
    return classifyCredentialPreflight({
      binding: 'present',
      requirementMatches: true,
      resolutionBoundary: 'trusted-host',
      destinationAllowed: true,
      providerAvailable: true,
      providerRead: 'failed',
    });
  }
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
