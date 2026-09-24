import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  /** Removes a composed dir; a no-op for `env` and `repo`. */
  cleanup: (this: void) => void;
}

export interface ResolvePiAgentDirOptions {
  /** Defaults to the store's `secrets/` file provider. */
  secretProviders?: Pick<SecretProviderRegistry, 'resolve'>;
  /** Parent of the composed dir. Defaults to `os.tmpdir()`. */
  tempRoot?: string;
}

interface PiModelsDocument {
  providers: Record<string, { models?: Array<{ id: string }> }>;
}

/**
 * Pick the Pi agent dir for direct `once`/`poll`/`drain` runs:
 *
 * 1. `PI_CODING_AGENT_DIR`, unchanged (`env`).
 * 2. When the Agent Server store has providers or a subscription login, a
 *    private dir built like an Agent Server run, with `<agentRoot>/.pi`
 *    config the store does not define layered in (`store`).
 * 3. `<agentRoot>/.pi` (`repo`).
 */
export async function resolvePiAgentDir(
  cfg: Pick<
    DaemonConfig,
    'piCodingAgentDir' | 'agentServerRoot' | 'profilePrerequisiteEnv'
  >,
  agentRoot: string,
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

  const repoPiDir = join(agentRoot, '.pi');
  const store = new AgentServerStore(
    resolveAgentServerRoot({ root: cfg.agentServerRoot || undefined }),
  );
  const providers = store.readProviders();
  const storeHasAuth = existsSync(store.piAuthJsonPath);
  if (Object.keys(providers).length === 0 && !storeHasAuth) {
    mkdirSync(repoPiDir, { recursive: true });
    return { path: repoPiDir, source: 'repo', env: {}, cleanup: noop };
  }

  // mkdtemp creates the directory owner-only (0700).
  const path = mkdtempSync(join(options.tempRoot ?? tmpdir(), 'moltnet-pi-'));
  const cleanup = () => rmSync(path, { recursive: true, force: true });
  try {
    writeStorePiConfig(path, providers);
    const repoModelsPath = join(repoPiDir, 'models.json');
    if (existsSync(repoModelsPath)) {
      const modelsPath = join(path, 'models.json');
      const merged = mergePiModels(
        readPiModels(modelsPath),
        readPiModels(repoModelsPath),
      );
      writeFileSync(modelsPath, `${JSON.stringify(merged, null, 2)}\n`, {
        mode: 0o600,
      });
    }
    const repoSettingsPath = join(repoPiDir, 'settings.json');
    if (existsSync(repoSettingsPath)) {
      copyFileSync(repoSettingsPath, join(path, 'settings.json'));
    }
    // Store and repo auth are never merged: a store login wins.
    const repoAuthPath = join(repoPiDir, 'auth.json');
    linkPiAuth(
      storeHasAuth || !existsSync(repoAuthPath)
        ? store.piAuthJsonPath
        : repoAuthPath,
      path,
    );

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

function readPiModels(path: string): PiModelsDocument {
  try {
    const parsed = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as Partial<PiModelsDocument> | null;
    if (typeof parsed?.providers === 'object' && parsed.providers !== null) {
      return parsed as PiModelsDocument;
    }
  } catch {
    // Reported below without echoing file content.
  }
  throw new Error(`${path} is not a valid Pi models document`);
}

/**
 * Store entries win per provider id. Repo models the store lacks are appended
 * with their metadata; repo-only providers are added unchanged.
 */
function mergePiModels(
  store: PiModelsDocument,
  repo: PiModelsDocument,
): PiModelsDocument {
  const providers = { ...repo.providers, ...store.providers };
  for (const [id, storeProvider] of Object.entries(store.providers)) {
    const repoModels = repo.providers[id]?.models ?? [];
    const known = new Set((storeProvider.models ?? []).map((m) => m.id));
    providers[id] = {
      ...storeProvider,
      models: [
        ...(storeProvider.models ?? []),
        ...repoModels.filter((m) => !known.has(m.id)),
      ],
    };
  }
  return { providers };
}
