import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProviderFailureProfileContext } from '@themoltnet/pi-runtime';
import {
  parseSecretReferenceString,
  type SecretProviderRegistry,
} from '@themoltnet/sdk';
import {
  createNodeSecretProviderRegistry,
  FileSecretProvider,
} from '@themoltnet/sdk/node';

import type { DaemonConfig } from '../config.js';
import {
  linkPiAuth,
  writeStorePiConfig,
} from './agent-server/pi-store-config.js';
import {
  AgentServerStore,
  resolveAgentServerRoot,
} from './agent-server/store.js';

export type PiAgentDirSource =
  ProviderFailureProfileContext['piAgentDirSource'];

export interface PiAgentDir {
  path: string;
  source: PiAgentDirSource;
  /** Store provider API keys the composed `models.json` references. */
  env: Record<string, string>;
  /** Removes a composed dir; a no-op for an explicit `env` directory. */
  cleanup: (this: void) => void;
}

export interface ResolvePiAgentDirOptions {
  /** Defaults to the store's `secrets/` file provider. */
  secretProviders?: Pick<SecretProviderRegistry, 'resolve'>;
  /** Parent of the composed dir. Defaults to `os.tmpdir()`. */
  tempRoot?: string;
}

/**
 * Use an explicitly selected Pi directory, or compose a private directory
 * from the MoltNet provider store. Repository .pi files are never inferred.
 */
export async function resolvePiAgentDir(
  cfg: Pick<
    DaemonConfig,
    'piCodingAgentDir' | 'agentServerRoot' | 'profilePrerequisiteEnv'
  >,
  profiles: ReadonlyArray<{ provider: string }>,
  options: ResolvePiAgentDirOptions = {},
): Promise<PiAgentDir> {
  const noop = () => undefined;
  if (cfg.piCodingAgentDir) {
    mkdirSync(cfg.piCodingAgentDir, { recursive: true });
    return {
      path: cfg.piCodingAgentDir,
      source: 'env',
      env: {},
      cleanup: noop,
    };
  }

  const store = new AgentServerStore(
    resolveAgentServerRoot({ root: cfg.agentServerRoot || undefined }),
  );
  const providers = store.readProviders();

  // mkdtemp creates the directory owner-only (0700).
  const path = mkdtempSync(join(options.tempRoot ?? tmpdir(), 'moltnet-pi-'));
  const cleanup = () => rmSync(path, { recursive: true, force: true });
  try {
    writeStorePiConfig(path, providers);
    linkPiAuth(store.piAuthJsonPath, path);

    const secretProviders =
      options.secretProviders ??
      createNodeSecretProviderRegistry().register(
        new FileSecretProvider({ root: store.secretsDir }),
      );
    const env: Record<string, string> = {};
    for (const providerId of new Set(profiles.map((p) => p.provider))) {
      const provider = providers[providerId];
      if (!provider?.apiKeyRef) continue;
      if (cfg.profilePrerequisiteEnv[provider.envName]) continue;
      try {
        env[provider.envName] = await secretProviders.resolve(
          parseSecretReferenceString(provider.apiKeyRef),
        );
      } catch {
        throw new Error(
          `provider "${providerId}" API key could not be resolved from the Agent Server store`,
        );
      }
    }
    return { path, source: 'store', env, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
