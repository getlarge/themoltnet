import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { Whoami } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';

import type { Agent } from './agent.js';
import {
  normalizeOptionalApiUrl,
  requireSecureCredentialApiUrl,
} from './api-url.js';
import { connect, type ConnectOptions } from './connect.js';
import {
  assertIdentityAlias,
  deriveMcpUrl,
  getIdentityDir,
  type MoltNetConfig,
  type SecretReference,
  writeConfig,
} from './credentials.js';
import { MoltNetError, NetworkError, RegisterIdentityError } from './errors.js';
import {
  type BootstrapCredentialType,
  type RegistrationRequestResult,
  requestRegistration,
} from './register.js';
import {
  agentKeyKey,
  identitySeedKey,
  oauth2SecretKey,
  type SecretProvider,
} from './secrets.js';

export type ConnectForRegistration = (
  options: ConnectOptions,
) => Promise<Pick<Agent, 'agents'>>;

export interface RegisterOptions {
  /** Identity alias; becomes the directory name and the published network alias. */
  name: string;
  apiUrl?: string;
  /** Default `oauth2`. Agent keys are what the daemon's managed agents use. */
  credentialType?: BootstrapCredentialType;
  /** Redeem this token into its issuing team instead of self-registering. */
  enrollmentToken?: string;
  /** Where the seed and the credential secret are stored. Default: OS keyring. */
  secretProvider?: SecretProvider;
  /** Identity directory. Default: `<config dir>/identities/<name>`. */
  configDir?: string;
  /** Publish `name` as the network alias. Default true for OAuth2; never for agent keys. */
  publishAlias?: boolean;
  signal?: AbortSignal;
  /**
   * Connection factory for the post-registration whoami. Defaults to the
   * in-memory `connect`; the daemon injects its own so tests and supervisors
   * control the connection.
   */
  connectAgent?: ConnectForRegistration;
}

export interface RegisterResult {
  alias: string;
  configPath: string;
  config: MoltNetConfig;
  identity: { subjectId: string; publicKey: string; fingerprint: string };
  whoami: Whoami;
  aliasPublished: boolean;
}

const IDENTITY_OPERATION_TIMEOUT_MS = 15_000;

let defaultProviderFactory: (() => SecretProvider) | undefined;

/** Set once by the `/node` entry so `register()` defaults to the OS keyring. */
export function setDefaultRegistrationSecretProvider(
  factory: () => SecretProvider,
): void {
  defaultProviderFactory = factory;
}

function defaultProvider(): SecretProvider {
  if (!defaultProviderFactory) {
    throw new RegisterIdentityError(
      'provider_unavailable',
      'no default secret provider is configured; pass secretProvider',
    );
  }
  return defaultProviderFactory();
}

function boundedSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(IDENTITY_OPERATION_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function recoveryCommand(alias: string): string {
  return `MOLTNET_ACTIVE_IDENTITY=${alias} moltnet agents credentials recover --yes`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

type WritableSecretProvider = SecretProvider &
  Required<Pick<SecretProvider, 'write' | 'delete'>>;

/**
 * Prove the provider can store and remove a value before any remote identity
 * exists, so a missing keyring fails here rather than after registration.
 */
async function preflightProvider(
  provider: SecretProvider,
): Promise<WritableSecretProvider> {
  if (!provider.capabilities.write || !provider.write || !provider.delete) {
    throw new RegisterIdentityError(
      'provider_unavailable',
      `secret provider "${provider.name}" cannot store secrets`,
    );
  }
  const writable = provider as WritableSecretProvider;
  const key = `preflight/${process.pid}/${Date.now()}`;
  try {
    await writable.write(key, 'credential-store-preflight');
    await writable.delete(key);
  } catch (cause) {
    throw new RegisterIdentityError(
      'provider_unavailable',
      `secret provider "${provider.name}" is unavailable; registration was not attempted`,
      { cause },
    );
  }
  return writable;
}

function isDefinitiveRejection(error: unknown): error is MoltNetError {
  return (
    error instanceof MoltNetError &&
    !(error instanceof NetworkError) &&
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  );
}

/**
 * Register an identity the way `moltnet register --name` does: the seed is
 * stored first, the config is written with references right after the server
 * commits, the credential secret is stored last, and the result is verified
 * with an authenticated whoami. A failure after the commit leaves everything
 * `moltnet agents credentials recover --yes` needs.
 */
export async function register(
  options: RegisterOptions,
): Promise<RegisterResult> {
  const alias = assertIdentityAlias(options.name);
  const credentialType = options.credentialType ?? 'oauth2';
  const apiUrl = requireSecureCredentialApiUrl(
    normalizeOptionalApiUrl(options.apiUrl),
  );
  const configDir = options.configDir ?? getIdentityDir(alias);
  const configPath = join(configDir, 'moltnet.json');
  const connectAgent = options.connectAgent ?? connect;

  if (await exists(configPath)) {
    throw new RegisterIdentityError(
      'alias_exists',
      `identity "${alias}" already exists at ${configPath}`,
      { configPath },
    );
  }
  const provider = await preflightProvider(
    options.secretProvider ?? defaultProvider(),
  );

  const keyPair = await cryptoService.generateKeyPair();
  const seedRef: SecretReference = {
    provider: provider.name,
    key: identitySeedKey(keyPair.fingerprint),
  };
  try {
    await provider.write(seedRef.key, keyPair.privateKey);
  } catch (cause) {
    throw new RegisterIdentityError(
      'provider_unavailable',
      `could not store the identity seed in "${provider.name}"; registration was not attempted`,
      { cause },
    );
  }

  let registration: RegistrationRequestResult;
  try {
    registration = await requestRegistration({
      credentialType,
      enrollmentToken: options.enrollmentToken,
      apiUrl,
      keyPair,
      signal: options.signal,
    });
  } catch (cause) {
    // The seed is never deleted here. Even a rejection costs only an unused
    // provider entry, while a failure that followed a commit would leave an
    // identity nobody can recover.
    const seedKept = `the identity seed (fingerprint ${keyPair.fingerprint}) is kept at ${seedRef.provider}:${seedRef.key}`;
    if (isDefinitiveRejection(cause)) {
      throw new RegisterIdentityError(
        'registration_failed',
        `registration for "${alias}" was rejected (${cause.statusCode}): ${cause.detail?.trim() || cause.message}; ${seedKept}`,
        {
          cause,
          statusCode: cause.statusCode,
          detail: cause.detail,
          fingerprint: keyPair.fingerprint,
          seedReference: seedRef,
        },
      );
    }
    throw new RegisterIdentityError(
      'registration_incomplete',
      `registration for "${alias}" did not complete and the server may have registered it; ${seedKept}`,
      { cause, fingerprint: keyPair.fingerprint, seedReference: seedRef },
    );
  }

  const { subjectId, fingerprint } = registration.identity;
  const credentials = registration.credentials;
  const recovery = recoveryCommand(alias);
  if (credentials.type !== credentialType) {
    throw new RegisterIdentityError(
      'unsupported_credential',
      `registration returned credential type "${credentials.type}", expected "${credentialType}"`,
      { subjectId, fingerprint, recoveryCommand: recovery },
    );
  }

  const credentialRef: SecretReference =
    credentials.type === 'oauth2'
      ? {
          provider: provider.name,
          key: oauth2SecretKey(subjectId, credentials.clientId),
        }
      : { provider: provider.name, key: agentKeyKey(subjectId) };
  const base = {
    subject_id: subjectId,
    subject_type: 'agent' as const,
    registered_at: new Date().toISOString(),
    keys: {
      public_key: keyPair.publicKey,
      fingerprint,
      private_key_ref: seedRef,
    },
    endpoints: {
      api: registration.apiUrl,
      mcp: deriveMcpUrl(registration.apiUrl),
    },
  };
  const config: MoltNetConfig =
    credentials.type === 'oauth2'
      ? {
          ...base,
          oauth2: {
            client_id: credentials.clientId,
            client_secret_ref: credentialRef,
          },
        }
      : { ...base, agent_key_ref: credentialRef };

  const incomplete = (message: string, cause?: unknown) =>
    new RegisterIdentityError(
      'registration_incomplete',
      `${message}; ${recovery} completes it`,
      {
        cause,
        subjectId,
        fingerprint,
        configPath,
        recoveryCommand: recovery,
        seedReference: seedRef,
      },
    );

  // The config carries both references before the credential secret exists,
  // so from here on the CLI recovery command can finish the job.
  try {
    await writeConfig(config, configDir);
  } catch (cause) {
    throw incomplete(
      `the agent ${subjectId} is registered and its seed is stored, but the config could not be written`,
      cause,
    );
  }
  try {
    await provider.write(
      credentialRef.key,
      credentials.type === 'oauth2'
        ? credentials.clientSecret
        : credentials.secret,
    );
  } catch (cause) {
    throw incomplete(
      `the agent ${subjectId} is registered and its config is written, but the credential secret could not be stored`,
      cause,
    );
  }

  const signal = boundedSignal(options.signal);
  let agents: Agent['agents'];
  let whoami: Whoami;
  try {
    const connectOptions: ConnectOptions =
      credentials.type === 'oauth2'
        ? {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            apiUrl: registration.apiUrl,
            signal,
          }
        : { agentKey: credentials.secret, apiUrl: registration.apiUrl, signal };
    agents = (await connectAgent(connectOptions)).agents;
    whoami = await agents.whoami({ signal });
  } catch (cause) {
    throw incomplete(
      `the agent ${subjectId} is registered and stored, but the authenticated whoami failed`,
      cause,
    );
  }
  if (
    whoami.subjectType !== 'agent' ||
    whoami.subjectId !== subjectId ||
    (whoami.publicKey !== undefined &&
      whoami.publicKey !== keyPair.publicKey) ||
    (whoami.fingerprint !== undefined && whoami.fingerprint !== fingerprint)
  ) {
    throw new RegisterIdentityError(
      'identity_mismatch',
      `authenticated whoami does not match the registered identity ${subjectId}`,
      { subjectId, fingerprint, configPath },
    );
  }

  let aliasPublished = false;
  // PATCH /agents/whoami accepts only the primary credential; an agent key is
  // rejected, so publication is an OAuth2-only step.
  if (credentials.type === 'oauth2' && options.publishAlias !== false) {
    try {
      const updated = await agents.updateWhoami({ alias }, { signal });
      aliasPublished = updated.subjectId === subjectId;
    } catch {
      aliasPublished = false;
    }
  }

  return {
    alias,
    configPath,
    config,
    identity: { subjectId, publicKey: keyPair.publicKey, fingerprint },
    whoami,
    aliasPublished,
  };
}

/** `register()` with a required enrollment token: the identity joins the issuing team. */
export function enroll(
  options: RegisterOptions & { enrollmentToken: string },
): Promise<RegisterResult> {
  return register(options);
}
