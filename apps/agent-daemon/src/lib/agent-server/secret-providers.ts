import {
  createNodeSecretProviderRegistry,
  FileSecretProvider,
} from '@themoltnet/sdk/node';

import type { ConnectionSettingsStore } from './connection-settings.js';
import type { AgentServerStore } from './store.js';

export function createAgentServerSecretProviders(
  settings: ConnectionSettingsStore,
  store: AgentServerStore,
) {
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  // Connection directories own file secrets; keyring references belong to the store.
  const registry = () =>
    createNodeSecretProviderRegistry({ store: { root: settings.root } });
  return {
    secrets,
    secretProviders: registry().register(secrets),
    externalSecretProviders: registry(),
  };
}
