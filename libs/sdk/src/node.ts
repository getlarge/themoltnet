import { homedir } from 'node:os';

import {
  type StoreRootOptions,
  storeSecretService,
} from '@moltnet/agent-config';

import type { Agent } from './agent.js';
import { readEnvironmentVariable } from './config.js';
import {
  type AmbientConnectOptions,
  connectAmbient,
} from './connect-ambient.js';
import { resolveOAuth2ClientSecret } from './credential-resolver.js';
import type { MoltNetConfig } from './credentials.js';
export { CredentialPersistenceError } from './credential-persistence.js';
export {
  EnrollmentRecoveryError,
  enrollTeam,
  type EnrollTeamOptions,
  type EnrollTeamResult,
  ProvisioningNotStartedError,
} from './enroll-team.js';
export {
  discardEnrollmentRecovery,
  type EnrollmentRecoverySummary,
  EnrollmentRestoreError,
  listEnrollmentRecoveries,
  restoreCapturedEnrollment,
} from './enroll-team-recovery.js';
import {
  type EnvironmentLookup,
  FileSecretProvider,
  fileSecretProviderOptionsFromEnv,
} from './file-secret-provider.js';
import {
  type AliasPublication,
  boundedIdentitySignal,
  enroll,
  register,
  type RegisterOptions,
  type RegisterResult,
  setDefaultRegistrationSecretProvider,
} from './register-node.js';
import {
  createDefaultSecretProviderRegistry,
  MOLTNET_SECRET_SERVICE,
  OS_KEYRING_SECRET_PROVIDER,
  READ_WRITE_CAPABILITIES,
  type SecretProbeResult,
  type SecretProvider,
  type SecretProviderRegistry,
} from './secrets.js';

type LoadedKeyringProvider = Required<
  Pick<SecretProvider, 'read' | 'write' | 'delete' | 'probe'>
>;

type OSKeyringModule = {
  OSKeyringSecretProvider: new (
    platform?: NodeJS.Platform,
    loader?: undefined,
    service?: string,
  ) => LoadedKeyringProvider;
};

/**
 * Lazy Node adapter. Browser SDK installs never pull in native keyring
 * packages, and Node consumers only load the adapter when an os-keyring
 * reference is actually used.
 */
export class OSKeyringSecretProvider implements SecretProvider {
  readonly name = OS_KEYRING_SECRET_PROVIDER;
  readonly capabilities = READ_WRITE_CAPABILITIES;
  private providerPromise: Promise<LoadedKeyringProvider> | undefined;
  private readonly storeOptions: StoreRootOptions;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    storeOptions?: StoreRootOptions,
  ) {
    this.storeOptions = {
      root: storeOptions?.root,
      home: storeOptions?.home ?? homedir(),
      cwd: storeOptions?.cwd ?? process.cwd(),
      // Snapshot selection without filesystem access; env/file users never
      // need to resolve a keyring namespace.
      env: {
        MOLTNET_AGENT_SERVER_ROOT: storeOptions?.env
          ? storeOptions.env.MOLTNET_AGENT_SERVER_ROOT
          : readEnvironmentVariable('MOLTNET_AGENT_SERVER_ROOT'),
        MOLTNET_DEFAULT_STORE_ROOT: storeOptions?.env
          ? storeOptions.env.MOLTNET_DEFAULT_STORE_ROOT
          : readEnvironmentVariable('MOLTNET_DEFAULT_STORE_ROOT'),
        MOLTNET_HOME: storeOptions?.env
          ? storeOptions.env.MOLTNET_HOME
          : readEnvironmentVariable('MOLTNET_HOME'),
      },
    };
  }

  async read(key: string): Promise<string | null> {
    return (await this.provider()).read(key);
  }

  async write(key: string, value: string): Promise<void> {
    await (await this.provider()).write(key, value);
  }

  async delete(key: string): Promise<void> {
    await (await this.provider()).delete(key);
  }

  async probe(key: string): Promise<SecretProbeResult> {
    try {
      return await (await this.provider()).probe(key);
    } catch {
      return 'inaccessible';
    }
  }

  private provider(): Promise<LoadedKeyringProvider> {
    // The package remains isomorphic; this explicit /node entry is the only
    // surface allowed to load the optional Node-only adapter.
    this.providerPromise ??= Promise.resolve().then(() => {
      const service = storeSecretService(this.storeOptions);
      // eslint-disable-next-line @nx/enforce-module-boundaries
      return import('@themoltnet/os-keyring')
        .then(
          ({ OSKeyringSecretProvider: Provider }: OSKeyringModule) =>
            new Provider(this.platform, undefined, service),
        )
        .catch((error: unknown) => {
          throw new Error(
            'OS keyring support requires @themoltnet/os-keyring; install it in this Node application',
            { cause: error },
          );
        });
    });
    return this.providerPromise;
  }
}

// The persisting register() defaults to the OS keyring only through this Node
// entry; the isomorphic root never loads the adapter.
setDefaultRegistrationSecretProvider(() => new OSKeyringSecretProvider());

export function windowsKeyringTarget(
  service: string,
  key: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return platform === 'win32' ? `${service}/${key}` : undefined;
}

export interface NodeSecretProviderRegistryOptions {
  platform?: NodeJS.Platform;
  readEnv?: EnvironmentLookup;
  store?: StoreRootOptions;
}

export function createNodeSecretProviderRegistry(
  options?: NodeSecretProviderRegistryOptions,
): SecretProviderRegistry;
export function createNodeSecretProviderRegistry(
  platform?: NodeJS.Platform,
  readEnv?: EnvironmentLookup,
  storeOptions?: StoreRootOptions,
): SecretProviderRegistry;
export function createNodeSecretProviderRegistry(
  options: NodeSecretProviderRegistryOptions | NodeJS.Platform = {},
  readEnv: EnvironmentLookup = readEnvironmentVariable,
  storeOptions?: StoreRootOptions,
): SecretProviderRegistry {
  const selected =
    typeof options === 'string'
      ? { platform: options, readEnv, store: storeOptions }
      : { readEnv, store: storeOptions, ...options };
  const platform = selected.platform ?? process.platform;
  return createDefaultSecretProviderRegistry()
    .register(new OSKeyringSecretProvider(platform, selected.store))
    .register(
      new FileSecretProvider(
        fileSecretProviderOptionsFromEnv(
          selected.readEnv ?? readEnvironmentVariable,
          platform,
        ),
      ),
    );
}

/** Resolve either a legacy plaintext secret or an opaque reference in Node. */
export async function resolveNodeOAuth2ClientSecret(
  config: MoltNetConfig,
  secretProviders = createNodeSecretProviderRegistry(),
): Promise<string> {
  return resolveOAuth2ClientSecret(config, secretProviders);
}

/** Node entry point: includes the lazy OS keyring unless callers supply a registry. */
export function connect(options: AmbientConnectOptions = {}): Promise<Agent> {
  return connectAmbient({
    ...options,
    secretProviders:
      options.secretProviders ?? createNodeSecretProviderRegistry(),
  });
}

export {
  DEFAULT_SECRET_MAX_BYTES,
  type EnvironmentLookup,
  FILE_SECRET_PROVIDER,
  type FileSecretErrorCode,
  FileSecretProvider,
  FileSecretProviderError,
  type FileSecretProviderOptions,
  fileSecretProviderOptionsFromEnv,
  MOLTNET_SECRET_MAX_BYTES_ENV,
  MOLTNET_SECRET_ROOT_ENV,
  MOLTNET_SECRET_ROOT_WRITABLE_ENV,
  validateFileSecretKey,
} from './file-secret-provider.js';
export { MOLTNET_SECRET_SERVICE };
export type { AmbientConnectOptions as ConnectOptions };
export {
  type AliasPublication,
  boundedIdentitySignal,
  enroll,
  register,
  type RegisterOptions,
  type RegisterResult,
};
export {
  RegisterIdentityError,
  type RegisterIdentityErrorCode,
} from './errors.js';
export type { ConnectForRegistration } from './register-node.js';
export {
  canonicalDirectory,
  canonicalStoreRoot,
  defaultStoreRoot,
  getProjectConfigPath,
  isDefaultStore,
  type ProjectBinding,
  type ProjectConfig,
  ProjectConfigError,
  type ProjectSelectionOptions,
  readProjectConfig,
  resolveProjectBinding,
  resolveStoreRoot,
  resolveStoreSelection,
  type StoreRootOptions,
  storeSecretService,
  WORKSPACE_STRATEGIES,
  type WorkspaceStrategy,
} from '@moltnet/agent-config';
/**
 * @internal Supervisor plumbing for the agent daemon, which must share this
 * package's `ProjectConfigError` class rather than bundle its own copy. Not a
 * supported SDK API: signatures follow the Go CLI grammar and may change in
 * any release.
 */
export {
  normalizeProjectEndpoint,
  updateProjectConfig,
  validateProjectConfig,
} from '@moltnet/agent-config';
