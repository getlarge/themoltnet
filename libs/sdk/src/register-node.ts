import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { Whoami } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';

import { withTimeout } from './abort.js';
import type { Agent } from './agent.js';
import {
  normalizeOptionalApiUrl,
  requireSecureCredentialApiUrl,
} from './api-url.js';
import { connect, type ConnectOptions } from './connect.js';
import {
  deriveMcpUrl,
  getIdentityDir,
  IDENTITY_ALIAS_PATTERN,
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

/**
 * Outcome of publishing the alias as the network alias. `skipped` covers agent
 * keys, which the API refuses for publication, and `publishAlias: false`.
 */
export type AliasPublication =
  | { status: 'published' }
  | { status: 'skipped' }
  | { status: 'failed'; error: string };

export interface RegisterResult {
  alias: string;
  configPath: string;
  config: MoltNetConfig;
  identity: { subjectId: string; publicKey: string; fingerprint: string };
  whoami: Whoami;
  aliasPublication: AliasPublication;
}

/** Bound for one identity operation such as an authenticated whoami. */
const IDENTITY_OPERATION_TIMEOUT_MS = 15_000;
/** Bound for each registration attempt; the Go CLI's HTTP client uses the same. */
const REGISTRATION_ATTEMPT_TIMEOUT_MS = 30_000;

/** `signal`, also aborted after `IDENTITY_OPERATION_TIMEOUT_MS`. */
export function boundedIdentitySignal(signal?: AbortSignal): AbortSignal {
  return withTimeout(IDENTITY_OPERATION_TIMEOUT_MS, signal);
}

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

/**
 * A 4xx is a definitive refusal, except 409: the registration route returns it
 * while a registration for the same key is still in progress and may commit.
 * Keep in step with `registrationRejected` in apps/moltnet-cli/register.go.
 */
function isDefinitiveRejection(error: unknown): error is MoltNetError {
  return (
    error instanceof MoltNetError &&
    !(error instanceof NetworkError) &&
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    error.statusCode !== 409
  );
}

/** The first whoami field that does not match the registered identity. */
function whoamiMismatch(
  whoami: Whoami,
  expected: { subjectId: string; publicKey: string; fingerprint: string },
): string | undefined {
  if (whoami.subjectType !== 'agent') {
    return `subject type "${whoami.subjectType}"`;
  }
  if (whoami.subjectId !== expected.subjectId) {
    return `subject ${whoami.subjectId}`;
  }
  if (whoami.publicKey !== expected.publicKey) {
    return `public key ${whoami.publicKey ?? '(none)'}`;
  }
  if (whoami.fingerprint !== expected.fingerprint) {
    return `fingerprint ${whoami.fingerprint ?? '(none)'}`;
  }
  return undefined;
}

/**
 * Register an identity the way `moltnet register --name` does: the seed is
 * stored first, the config is created exclusively with references right after
 * the server commits, the credential secret is stored last, and the result is
 * verified with an authenticated whoami. Every failure after the seed is
 * stored names where it is kept; once the config exists,
 * `moltnet agents credentials recover --yes` can finish the job.
 */
export async function register(
  options: RegisterOptions,
): Promise<RegisterResult> {
  if (!IDENTITY_ALIAS_PATTERN.test(options.name)) {
    throw new RegisterIdentityError(
      'invalid_alias',
      `invalid identity alias "${options.name}": use 1-63 letters, digits, ".", "_" or "-", starting with a letter or digit`,
    );
  }
  const alias = options.name;
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
  // The seed is never deleted from here on: a rejection costs only an unused
  // provider entry, while a failure that followed a commit would otherwise
  // leave an identity nobody can recover.
  const seedKept = `the identity seed (fingerprint ${keyPair.fingerprint}) is kept at ${seedRef.provider}:${seedRef.key}`;

  let registration: RegistrationRequestResult;
  try {
    registration = await requestRegistration({
      credentialType,
      enrollmentToken: options.enrollmentToken,
      apiUrl,
      keyPair,
      signal: options.signal,
      attemptTimeoutMs: REGISTRATION_ATTEMPT_TIMEOUT_MS,
    });
  } catch (cause) {
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
  // Every failure below follows a server-side commit.
  const committed = { subjectId, fingerprint, seedReference: seedRef };
  if (credentials.type !== credentialType) {
    throw new RegisterIdentityError(
      'unsupported_credential',
      `registration returned credential type "${credentials.type}", expected "${credentialType}"; agent ${subjectId} is registered and ${seedKept}`,
      committed,
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

  // The config carries both references before the credential secret exists,
  // so from here on the CLI recovery command can finish the job. It is created
  // exclusively: a concurrent registration of the same alias must not lose its
  // config to this one.
  try {
    await writeConfig(config, configDir, { exclusive: true });
  } catch (cause) {
    // Checked on disk rather than by error code: mkdir also reports EEXIST
    // when a file stands where the identity directory should be.
    const raced = await exists(configPath);
    throw new RegisterIdentityError(
      'registration_incomplete',
      raced
        ? `the agent ${subjectId} is registered, but identity "${alias}" was created by another process meanwhile, so its config was not written; ${seedKept}`
        : `the agent ${subjectId} is registered, but its config could not be written; ${seedKept}`,
      { cause, ...committed },
    );
  }

  const recovery = recoveryCommand(alias);
  const incomplete = (message: string, cause: unknown) =>
    new RegisterIdentityError(
      'registration_incomplete',
      `${message}; ${recovery} completes it`,
      { cause, ...committed, configPath, recoveryCommand: recovery },
    );

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

  const signal = boundedIdentitySignal(options.signal);
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
  const mismatch = whoamiMismatch(whoami, {
    subjectId,
    publicKey: keyPair.publicKey,
    fingerprint,
  });
  if (mismatch) {
    // No recovery command: recovery would act on the credential's identity,
    // which is exactly what disagrees with the registration.
    throw new RegisterIdentityError(
      'identity_mismatch',
      `authenticated whoami returned ${mismatch}, which does not match the registered identity ${subjectId}; its config is at ${configPath} and ${seedKept}`,
      { ...committed, configPath },
    );
  }

  let aliasPublication: AliasPublication = { status: 'skipped' };
  // PATCH /agents/whoami accepts only the primary credential; an agent key is
  // rejected, so publication is an OAuth2-only step.
  if (credentials.type === 'oauth2' && options.publishAlias !== false) {
    try {
      const updated = await agents.updateWhoami({ alias }, { signal });
      aliasPublication =
        updated.subjectId === subjectId
          ? { status: 'published' }
          : {
              status: 'failed',
              error: `the API answered for subject ${updated.subjectId}`,
            };
    } catch (cause) {
      aliasPublication = {
        status: 'failed',
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  return {
    alias,
    configPath,
    config,
    identity: { subjectId, publicKey: keyPair.publicKey, fingerprint },
    whoami,
    aliasPublication,
  };
}

/** `register()` with a required enrollment token: the identity joins the issuing team. */
export function enroll(
  options: RegisterOptions & { enrollmentToken: string },
): Promise<RegisterResult> {
  return register(options);
}
