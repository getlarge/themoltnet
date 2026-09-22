import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AgentServerStore,
  ConnectionSettingsStore,
  RuntimeRegistry,
} from '@themoltnet/agent-daemon/testing';
import { agentKeyKey, identitySeedKey } from '@themoltnet/sdk';
import { FileSecretProvider } from '@themoltnet/sdk/node';

import { readJourneySetup, writeJourney } from './journey.js';

const root = process.env.MOLTNET_DESKTOP_E2E_FIXTURE_ROOT;
const home = process.env.MOLTNET_HOME;
if (!root || home !== join(root, 'store'))
  throw new Error('Use the isolated Desktop Docker launcher');
const journey = readJourneySetup(root);
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
// Managed, as Desktop's own identities are: its references resolve through
// the store's secrets, where the keys were just written. An external
// activation would need MOLTNET_SECRET_ROOT, which Desktop never sets. The
// daemon still verifies this identity against whoami before every use.
store.writeActivation({
  source: 'managed',
  alias: 'desktop-personal',
  subjectId: journey.identity.subjectId,
  publicKey: journey.identity.publicKey,
  fingerprint: journey.identity.fingerprint,
  createdAt: new Date().toISOString(),
  apiUrl: journey.apiUrl,
});
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
// The identity now lives in the isolated store; keep no second copy on disk.
const { identity: _identity, ...rest } = journey;
writeJourney(root, rest);
