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

import {
  resolveRuntimeProfileModel,
  RuntimeProfileModelResolutionError,
} from '@themoltnet/pi-runtime';
import {
  parseSecretReferenceString,
  type SecretProviderRegistry,
} from '@themoltnet/sdk';
import {
  createNodeSecretProviderRegistry,
  FileSecretProvider,
} from '@themoltnet/sdk/node';

import {
  linkPiAuth,
  writeStorePiConfig,
} from './agent-server/pi-store-config.js';
import { AgentServerStore, type ProvidersState } from './agent-server/store.js';

export type PiAgentDirSource = 'env' | 'repo' | 'store' | 'store+repo';

export interface ResolvedPiAgentDir {
  path: string;
  source: PiAgentDirSource;
}

export function ensurePiAgentDir(
  repoRoot: string,
  explicitPath: string,
): ResolvedPiAgentDir {
  if (explicitPath) {
    mkdirSync(explicitPath, { recursive: true });
    return { path: explicitPath, source: 'env' };
  }

  const path = join(repoRoot, '.pi');
  mkdirSync(path, { recursive: true });
  return { path, source: 'repo' };
}

export class PiAgentDirResolutionError extends Error {
  override name = 'PiAgentDirResolutionError';
}

export interface ComposedPiAgentDir extends ResolvedPiAgentDir {
  /** Where the composed `auth.json` link points; absent for env/repo. */
  authSource?: 'store' | 'repo';
  /** Provider API keys resolved from the store, keyed by env var name. */
  providerEnv: Record<string, string>;
  /** Removes a composed dir; a no-op for env/repo dirs. */
  cleanup: (this: void) => void;
}

export interface ResolvePiAgentDirInput {
  /** Agent root whose `.pi` is the repository fallback. */
  repoRoot: string;
  /** `PI_CODING_AGENT_DIR`; empty when unset. */
  explicitPath: string;
  /** Agent Server store root (`resolveAgentServerRoot`). */
  storeRoot: string;
  /** Selected profiles; each must resolve in a composed catalog. */
  profiles: ReadonlyArray<{ id: string; provider: string; model: string }>;
  /** Existing environment; keys already set are never overridden. */
  env: NodeJS.ProcessEnv;
  /** Defaults to the store's `secrets/` file provider. */
  secretProviders?: Pick<SecretProviderRegistry, 'resolve'>;
  /** Parent of the private composed dir. Defaults to `os.tmpdir()`. */
  tempRoot?: string;
}

interface PiModelsDocument {
  providers: Record<string, { models?: Array<{ id: string }> } & object>;
}

/**
 * Resolve the Pi agent dir for direct `once`/`poll`/`drain` runs:
 *
 * 1. `PI_CODING_AGENT_DIR` wins unchanged (`env`).
 * 2. With a provider store (providers or Pi auth), compose a private dir the
 *    same way Agent Server runs do, merging repo `.pi` config the store does
 *    not define (`store` or `store+repo`).
 * 3. Otherwise `<repoRoot>/.pi`, exactly as before (`repo`).
 */
export async function resolvePiAgentDir(
  input: ResolvePiAgentDirInput,
): Promise<ComposedPiAgentDir> {
  const noop = () => undefined;
  if (input.explicitPath) {
    return {
      ...ensurePiAgentDir(input.repoRoot, input.explicitPath),
      providerEnv: {},
      cleanup: noop,
    };
  }

  const store = new AgentServerStore(input.storeRoot);
  const providers = existsSync(store.root) ? store.readProviders() : {};
  const storeHasAuth = existsSync(store.piAuthJsonPath);
  if (Object.keys(providers).length === 0 && !storeHasAuth) {
    return {
      ...ensurePiAgentDir(input.repoRoot, ''),
      providerEnv: {},
      cleanup: noop,
    };
  }

  const repoPiDir = join(input.repoRoot, '.pi');
  const repoModelsPath = join(repoPiDir, 'models.json');
  const repoAuthPath = join(repoPiDir, 'auth.json');
  const repoSettingsPath = join(repoPiDir, 'settings.json');
  const authSource =
    storeHasAuth || !existsSync(repoAuthPath) ? 'store' : 'repo';
  const repoModels = existsSync(repoModelsPath)
    ? readRepoModels(repoModelsPath)
    : null;
  const usesRepo =
    repoModels !== null ||
    authSource === 'repo' ||
    existsSync(repoSettingsPath);
  const source = usesRepo ? 'store+repo' : 'store';

  // mkdtemp creates the directory owner-only (0700).
  const path = mkdtempSync(join(input.tempRoot ?? tmpdir(), 'moltnet-pi-'));
  const cleanup = () => rmSync(path, { recursive: true, force: true });
  try {
    writeStorePiConfig(path, providers);
    if (repoModels) {
      const modelsPath = join(path, 'models.json');
      const storeModels = JSON.parse(
        readFileSync(modelsPath, 'utf8'),
      ) as PiModelsDocument;
      writeFileSync(
        modelsPath,
        `${JSON.stringify(mergePiModels(storeModels, repoModels), null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
    }
    if (existsSync(repoSettingsPath)) {
      copyFileSync(repoSettingsPath, join(path, 'settings.json'));
    }
    linkPiAuth(
      authSource === 'store' ? store.piAuthJsonPath : repoAuthPath,
      path,
    );

    const sources = source === 'store' ? 'store' : 'store, repo';
    for (const profile of input.profiles) {
      try {
        await resolveRuntimeProfileModel(
          path,
          profile.provider,
          profile.model,
          profile.id,
        );
      } catch (error) {
        if (!(error instanceof RuntimeProfileModelResolutionError)) throw error;
        throw new PiAgentDirResolutionError(
          `invalid_model: Runtime profile "${profile.id}" model ` +
            `"${profile.provider}/${profile.model}" was not found in the ` +
            `composed Pi catalog (sources searched: ${sources}).`,
        );
      }
    }

    return {
      path,
      source,
      authSource,
      providerEnv: await resolveProviderEnv(input, store, providers),
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function readRepoModels(path: string): PiModelsDocument {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { providers?: unknown }).providers === 'object' &&
      (parsed as { providers?: unknown }).providers !== null
    ) {
      return parsed as PiModelsDocument;
    }
  } catch {
    // Reported below without echoing file content.
  }
  throw new PiAgentDirResolutionError(
    'repository .pi/models.json is not a valid Pi models document',
  );
}

/**
 * Store entries win per provider id; repo models the store lacks are appended
 * with their full metadata, and repo-only providers are added unchanged.
 */
function mergePiModels(
  store: PiModelsDocument,
  repo: PiModelsDocument,
): PiModelsDocument {
  const providers = { ...store.providers };
  for (const [id, repoProvider] of Object.entries(repo.providers)) {
    const storeProvider = providers[id];
    if (!storeProvider) {
      providers[id] = repoProvider;
      continue;
    }
    const known = new Set((storeProvider.models ?? []).map((m) => m.id));
    providers[id] = {
      ...storeProvider,
      models: [
        ...(storeProvider.models ?? []),
        ...(repoProvider.models ?? []).filter((m) => !known.has(m.id)),
      ],
    };
  }
  return { providers };
}

async function resolveProviderEnv(
  input: ResolvePiAgentDirInput,
  store: AgentServerStore,
  providers: ProvidersState,
): Promise<Record<string, string>> {
  const selected = new Set(input.profiles.map((profile) => profile.provider));
  const secretProviders =
    input.secretProviders ??
    createNodeSecretProviderRegistry().register(
      new FileSecretProvider({ root: store.secretsDir }),
    );
  const env: Record<string, string> = {};
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!selected.has(providerId) || !provider.apiKeyRef) continue;
    if (input.env[provider.envName]) continue;
    try {
      env[provider.envName] = await secretProviders.resolve(
        parseSecretReferenceString(provider.apiKeyRef),
      );
    } catch {
      throw new PiAgentDirResolutionError(
        `provider "${providerId}" API key could not be resolved from the Agent Server store`,
      );
    }
  }
  return env;
}
