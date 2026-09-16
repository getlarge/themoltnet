/**
 * Builds an authenticated MoltNet client for a locally activated agent.
 *
 * Extracted from `RunManager` so the catalogue can reach the API with the same
 * credentials a run does. That is the point of the identity-scoped catalogue:
 * the composer reads exactly what the run it is about to start would read, so
 * the list it shows cannot promise work the run could not claim.
 *
 * The caller supplies the error type. Run start and catalogue reads map a
 * missing key to different HTTP outcomes, and injecting the constructor keeps
 * this module free of either taxonomy — and free of a cycle back into
 * `runs.ts`.
 */
import { resolveAgentKey, type SecretProviderRegistry } from '@themoltnet/sdk';
import { connect } from '@themoltnet/sdk/node';

import type { ActivatedAgent } from './identity.js';

export type ConnectImpl = typeof connect;
export type ConnectedAgent = Awaited<ReturnType<ConnectImpl>>;

export interface AgentConnectionOptions {
  activated: ActivatedAgent;
  teamId?: string;
  /** Providers backing agents this server manages. */
  secretProviders: SecretProviderRegistry;
  /** Providers backing agents configured outside this server. */
  externalSecretProviders: SecretProviderRegistry;
  onMissingKey: (message: string) => Error;
  /** Overridable for tests; defaults to the SDK's `connect`. */
  connectImpl?: ConnectImpl;
}

export async function connectActivatedAgent(
  options: AgentConnectionOptions,
): Promise<ConnectedAgent> {
  const { activated, onMissingKey, connectImpl = connect } = options;
  const { activation, config } = activated;
  const managed = activation.source === 'managed';
  const agentKey = await resolveAgentKey(
    config,
    managed ? options.secretProviders : options.externalSecretProviders,
    options.teamId ?? activation.boundTeamId,
  );
  if (!agentKey) {
    throw onMissingKey(
      `${managed ? 'managed' : 'external'} agent "${activation.alias}" has no agent key`,
    );
  }
  return connectImpl({
    agentKey,
    apiUrl: managed
      ? activation.apiUrl
      : (activation.apiUrl ?? activation.configApiUrl),
  });
}
