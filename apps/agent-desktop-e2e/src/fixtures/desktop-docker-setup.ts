import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AgentServerStore,
  attachExternalAgent,
  ConnectionSettingsStore,
  RuntimeRegistry,
} from '@themoltnet/agent-daemon/testing';
import {
  agentKeyKey,
  identitySeedKey,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { FileSecretProvider } from '@themoltnet/sdk/node';

const root = process.env.MOLTNET_DESKTOP_E2E_FIXTURE_ROOT;
const home = process.env.MOLTNET_HOME;
if (!root || home !== join(root, 'store'))
  throw new Error('Use the isolated Desktop Docker launcher');
const journey = JSON.parse(
  readFileSync(join(root, 'docker-journey.json'), 'utf8'),
) as {
  apiUrl: string;
  teamId: string;
  identity: {
    subjectId: string;
    publicKey: string;
    privateKey: string;
    fingerprint: string;
    agentKey: string;
  };
};
const settings = new ConnectionSettingsStore(home);
settings.save({
  apiUrl: journey.apiUrl,
  issuer: 'http://hydra:4444',
  publicUrl: process.env.ORY_HYDRA_PUBLIC_URL ?? 'http://localhost:4444',
});
const store = new AgentServerStore(settings.stateRoot()).ensure();
const secrets = new FileSecretProvider({
  root: store.secretsDir,
  writable: true,
});
const keyPath = agentKeyKey(journey.identity.subjectId, journey.teamId);
const seedPath = identitySeedKey(journey.identity.fingerprint);
await secrets.write(keyPath, journey.identity.agentKey);
await secrets.write(seedPath, journey.identity.privateKey);
store.writeAgentConfig('desktop-personal', {
  subject_id: journey.identity.subjectId,
  subject_type: 'agent',
  registered_at: new Date().toISOString(),
  agent_key_refs: { [journey.teamId]: { provider: 'file', key: keyPath } },
  keys: {
    public_key: journey.identity.publicKey,
    fingerprint: journey.identity.fingerprint,
    private_key_ref: { provider: 'file', key: seedPath },
  },
  endpoints: { api: journey.apiUrl, mcp: `${journey.apiUrl}/mcp` },
});
await attachExternalAgent(
  store,
  new SecretProviderRegistry().register(secrets),
  {
    name: 'desktop-personal',
    configDir: dirname(store.agentPath('desktop-personal')),
    apiUrl: journey.apiUrl,
    teamId: journey.teamId,
  },
);
await new RuntimeRegistry(store.root).register(
  'desktop_e2e',
  fileURLToPath(new URL('./runtime.mjs', import.meta.url)),
);
store.writeProviders({
  ollama: {
    envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:11434',
    models: [{ id: 'desktop-fixture' }],
  },
});
