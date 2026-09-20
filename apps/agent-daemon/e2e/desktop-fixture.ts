/** Real daemon HTTP/control stack with deterministic, local-only dependencies. */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SecretProviderRegistry } from '@themoltnet/sdk';
import { FileSecretProvider } from '@themoltnet/sdk/node';

import { ConnectionSettingsStore } from '../src/lib/agent-server/connection-settings.js';
import { publishAgentServerEndpoint } from '../src/lib/agent-server/endpoint.js';
import { acquireAgentServerLock } from '../src/lib/agent-server/lock.js';
import { NativeGrantService } from '../src/lib/agent-server/native-grant-service.js';
import { ProviderLoginService } from '../src/lib/agent-server/provider-login.js';
import { RunManager } from '../src/lib/agent-server/runs.js';
import { buildAgentServer } from '../src/lib/agent-server/server.js';
import { AgentServerStore } from '../src/lib/agent-server/store.js';
import { ProviderConfigurationService } from '../src/lib/provider-configuration.js';

const root = process.env.MOLTNET_HOME;
if (!root) throw new Error('Desktop fixture requires an isolated MOLTNET_HOME');
const store = new AgentServerStore(root).ensure();
const args = process.argv.slice(2);
const trustedPath = join(root, 'fixture-trusted');
if (args[0] === 'server' && args[1] === 'trust') {
  if (args.includes('--yes')) writeFileSync(trustedPath, 'fixture only');
  process.stdout.write(
    JSON.stringify({
      supported: true,
      trusted: existsSync(trustedPath),
      fingerprint: 'sha256:desktop-e2e',
    }),
  );
} else if (args[0] === 'server') {
  const lock = await acquireAgentServerLock(root);
  const nativeGrant = new NativeGrantService();
  nativeGrant.grantNative(process.env.MOLTNET_AGENT_SERVER_NATIVE_TOKEN ?? '');
  delete process.env.MOLTNET_AGENT_SERVER_NATIVE_TOKEN;
  const secrets = new FileSecretProvider({
    root: store.secretsDir,
    writable: true,
  });
  const providers = new SecretProviderRegistry().register(secrets);
  const runs = new RunManager({
    store,
    secretProviders: providers,
    externalSecretProviders: providers,
    baseEnv: { PATH: process.env.PATH },
    entrypoint: {
      execPath: process.execPath,
      execArgv: [],
      scriptPath: import.meta.filename,
    },
    spawnImpl: () => {
      throw new Error('No runtime configured in this fixture');
    },
  });
  const app = buildAgentServer({
    store,
    secrets,
    secretProviders: providers,
    externalSecretProviders: providers,
    nativeGrant,
    runs,
    connectionSettings: new ConnectionSettingsStore(root, {
      apiUrl: 'http://127.0.0.1:1',
      issuer: 'http://127.0.0.1:1',
      publicUrl: 'http://127.0.0.1:1',
    }),
    subscriptions: new ProviderLoginService({
      authPath: store.piAuthJsonPath,
      listProviders: () => [],
      runLogin: async () => {
        throw new Error('No external login in fixture');
      },
      isConnected: () => false,
    }),
    providers: new ProviderConfigurationService({
      store,
      secrets,
      secretProviders: providers,
    }),
    allowedOrigins: ['http://127.0.0.1:1'],
    defaultApiUrl: 'http://127.0.0.1:1',
    version: 'desktop-fixture',
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const discovery = publishAgentServerEndpoint(root, url);
  const stop = async () => {
    discovery.release();
    await app.close();
    await lock.release();
    process.exit(0);
  };
  process.stdin.resume();
  process.stdin.once('end', () => {
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
} else {
  throw new Error(`Unexpected Desktop fixture command: ${args.join(' ')}`);
}
