/**
 * Serve identity activation (#2061/#1834 boundary).
 *
 * Managed agent files are canonical `MoltNetConfig` documents. Alias,
 * provenance, pinned identity material, and external config paths live only
 * in the versioned activation map in `serve.json`. Every attach and run loads
 * the current config and verifies it with authenticated `whoami` before use.
 */
import { open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

import {
  type Agent,
  agentKeyKey,
  assertTrustedConfigApiUrl,
  deriveMcpUrl,
  identitySeedKey,
  type MoltNetConfig,
  MoltNetError,
  register,
  requireSecureCredentialApiUrl,
  resolveAgentKey,
  type SecretProviderRegistry,
  type Whoami,
} from '@themoltnet/sdk';
import {
  connect,
  type ConnectOptions,
  FILE_SECRET_PROVIDER,
  type FileSecretProvider,
} from '@themoltnet/sdk/node';

import { assessIdentityPin, type IdentityPin } from '../identity-pin.js';
import {
  type AgentActivation,
  assertStoreName,
  type ExternalAgentActivation,
  type ManagedAgentActivation,
  type ServeStore,
  ServeStoreError,
} from './store.js';

const MAX_CONFIG_BYTES = 64 * 1024;
const IDENTITY_OPERATION_TIMEOUT_MS = 15_000;
const pendingAliases = new WeakMap<ServeStore, Set<string>>();

export class ServeIdentityError extends Error {
  override name = 'ServeIdentityError';
  constructor(
    readonly code:
      | 'agent_exists'
      | 'config_not_found'
      | 'registration_failed'
      | 'registration_incomplete'
      | 'verification_failed'
      | 'unsupported_credential',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type ConnectAgent = (
  options?: ConnectOptions,
) => Promise<Pick<Agent, 'agents'>>;

export interface CreateManagedAgentInput {
  name: string;
  apiUrl: string;
  enrollmentToken?: string;
  signal?: AbortSignal;
}

export interface ActivatedAgent {
  activation: AgentActivation;
  config: MoltNetConfig;
  /**
   * Team the verified credential is bound to, straight from the
   * authenticated `whoami` — never cached. Runs fail fast when the spec
   * targets a different team than the key can act in.
   */
  boundTeamId?: string;
}

function reserveAlias(store: ServeStore, alias: string): () => void {
  let pending = pendingAliases.get(store);
  if (!pending) {
    pending = new Set<string>();
    pendingAliases.set(store, pending);
  }
  if (
    pending.has(alias) ||
    store.hasPendingRegistration(alias) ||
    store.readActivation(alias) ||
    store.readAgentConfig(alias)
  ) {
    throw new ServeIdentityError(
      'agent_exists',
      `agent "${alias}" already exists in the serve store`,
    );
  }
  pending.add(alias);
  return () => pending.delete(alias);
}

export async function createManagedAgent(
  store: ServeStore,
  secrets: FileSecretProvider,
  input: CreateManagedAgentInput,
): Promise<ActivatedAgent> {
  const alias = assertStoreName('agent name', input.name);
  const releaseAlias = reserveAlias(store, alias);
  let registeredIdentityId: string | undefined;
  try {
    let apiUrl: string;
    try {
      apiUrl = requireSecureCredentialApiUrl(input.apiUrl);
    } catch (cause) {
      throw new ServeIdentityError(
        'registration_failed',
        'registration API URL must use HTTPS or HTTP loopback',
        { cause },
      );
    }
    // This durable marker prevents a retry from creating a second remote
    // identity if registration commits but its response or a local write fails.
    store.reserveRegistration(alias, apiUrl);
    const result = await register({
      credentialType: 'agent_key',
      apiUrl,
      ...(input.enrollmentToken
        ? { enrollmentToken: input.enrollmentToken }
        : {}),
      signal: boundedIdentitySignal(input.signal),
    });
    if (result.credentials.type !== 'agent_key') {
      throw new ServeIdentityError(
        'unsupported_credential',
        `registration returned credential type "${result.credentials.type}"; serve manages agent-key credentials only`,
      );
    }

    const now = new Date().toISOString();
    const { identityId, fingerprint, publicKey, privateKey } = result.identity;
    registeredIdentityId = identityId;
    const agentKeyReference = {
      provider: FILE_SECRET_PROVIDER,
      key: agentKeyKey(identityId),
    };
    const seedReference = {
      provider: FILE_SECRET_PROVIDER,
      key: identitySeedKey(fingerprint),
    };
    const config: MoltNetConfig = {
      identity_id: identityId,
      registered_at: now,
      agent_key_ref: agentKeyReference,
      keys: {
        public_key: publicKey,
        fingerprint,
        private_key_ref: seedReference,
      },
      endpoints: {
        api: result.apiUrl,
        mcp: deriveMcpUrl(result.apiUrl),
      },
    };
    const activation: AgentActivation = {
      alias,
      source: 'managed',
      identityId,
      publicKey,
      fingerprint,
      createdAt: now,
      apiUrl: result.apiUrl,
    };
    // Persist the non-secret recovery record first. If a later write fails,
    // reserveAlias blocks accidental re-registration of the remote identity.
    store.writeAgentConfig(alias, config);
    await secrets.write(agentKeyReference.key, result.credentials.secret);
    await secrets.write(seedReference.key, privateKey);
    store.writeActivation(activation);
    return { activation, config };
  } catch (cause) {
    if (
      !registeredIdentityId &&
      cause instanceof MoltNetError &&
      cause.statusCode !== undefined &&
      cause.statusCode >= 400 &&
      cause.statusCode < 500
    ) {
      store.clearPendingRegistration(alias);
      throw new ServeIdentityError(
        'registration_failed',
        `registration for "${alias}" was rejected`,
        { cause },
      );
    }
    if (store.hasPendingRegistration(alias)) {
      throw new ServeIdentityError(
        'registration_incomplete',
        registeredIdentityId
          ? `identity "${registeredIdentityId}" was registered but local activation is incomplete; reconcile or clear its pending serve record before retrying`
          : `registration for "${alias}" may be incomplete; inspect the remote API before changing its pending serve record`,
        { cause },
      );
    }
    throw cause;
  } finally {
    releaseAlias();
  }
}

/** Resume a fully persisted registration or explicitly abandon local recovery. */
export async function reconcileManagedRegistration(
  store: ServeStore,
  secrets: FileSecretProvider,
  aliasInput: string,
  action: 'resume' | 'abandon',
  connectAgent: ConnectAgent = connect,
  signal?: AbortSignal,
): Promise<ActivatedAgent | null> {
  const alias = assertStoreName('agent name', aliasInput);
  const activation = store.readActivation(alias);
  if (activation) {
    const config = store.readAgentConfig(alias);
    if (!config) {
      throw new ServeIdentityError(
        'registration_incomplete',
        `managed activation for "${alias}" is missing its canonical config`,
      );
    }
    return { activation, config };
  }
  if (!store.hasPendingRegistration(alias)) {
    throw new ServeIdentityError(
      'config_not_found',
      `agent "${alias}" has no pending registration to reconcile`,
    );
  }
  const config = store.readAgentConfig(alias);
  if (action === 'abandon') {
    // The canonical config is mutable and therefore cannot authorize deletion.
    // Leave any partial secret files orphaned; a later store-level GC can clean
    // them from immutable registration metadata.
    store.removeAgentConfig(alias);
    store.clearPendingRegistration(alias);
    return null;
  }
  if (
    !config?.agent_key_ref ||
    config.agent_key_ref.provider !== FILE_SECRET_PROVIDER ||
    config.keys.private_key_ref?.provider !== FILE_SECRET_PROVIDER
  ) {
    throw new ServeIdentityError(
      'registration_incomplete',
      `pending registration for "${alias}" does not have complete managed references`,
    );
  }
  const [agentKey, privateKeyState] = await Promise.all([
    secrets.read(config.agent_key_ref.key),
    secrets.probe(config.keys.private_key_ref.key),
  ]);
  if (!agentKey || privateKeyState !== 'present') {
    throw new ServeIdentityError(
      'registration_incomplete',
      `pending registration for "${alias}" is missing persisted secret material`,
    );
  }
  const identity = identityFromConfig(config);
  const apiUrl = requireConfigApiUrl(config, store.agentPath(alias));
  const whoami = await callWhoami(
    connectAgent,
    { agentKey, apiUrl },
    store.agentPath(alias),
    signal,
  );
  assertIdentityMatches(
    whoami,
    identity,
    'authenticated whoami',
    `pending registration "${alias}" config`,
  );
  const recovered: ManagedAgentActivation = {
    alias,
    source: 'managed',
    ...identity,
    createdAt: config.registered_at,
    apiUrl,
  };
  store.writeActivation(recovered);
  return { activation: recovered, config };
}

export interface AttachExternalAgentInput {
  name: string;
  /** Absolute path to the existing `.moltnet/<agent>` directory. */
  configDir: string;
  apiUrl?: string;
  signal?: AbortSignal;
}

export async function attachExternalAgent(
  store: ServeStore,
  secretProviders: SecretProviderRegistry,
  input: AttachExternalAgentInput,
  connectAgent: ConnectAgent = connect,
): Promise<ActivatedAgent> {
  const alias = assertStoreName('agent name', input.name);
  const releaseAlias = reserveAlias(store, alias);
  try {
    if (!isAbsolute(input.configDir)) {
      throw new ServeIdentityError(
        'config_not_found',
        'external configDir must be an absolute path',
      );
    }
    const configPath = join(input.configDir, 'moltnet.json');
    externalAgentLocation(configPath);
    const config = await readCurrentConfig(configPath);
    const configApiUrl = requireTrustedConfigApiUrl(config, configPath);
    const effectiveApiUrl = requireTrustedApiOverride(
      input.apiUrl,
      configApiUrl,
      configPath,
    );
    const whoami = await authenticateConfig(
      input.configDir,
      effectiveApiUrl,
      secretProviders,
      connectAgent,
      input.signal,
    );
    const identity = identityFromConfig(config);
    assertIdentityMatches(
      identity,
      whoami,
      `external config ${configPath}`,
      'authenticated whoami',
    );

    const activation: AgentActivation = {
      alias,
      source: 'external',
      ...identity,
      createdAt: new Date().toISOString(),
      configPath,
      configApiUrl,
      ...(input.apiUrl ? { apiUrl: input.apiUrl } : {}),
    };
    store.writeActivation(activation);
    return { activation, config };
  } finally {
    releaseAlias();
  }
}

/** Load and authenticate the current config, then compare all pinned fields. */
export async function verifyAgentActivation(
  store: ServeStore,
  alias: string,
  managedSecretProviders: SecretProviderRegistry,
  externalSecretProviders: SecretProviderRegistry,
  connectAgent: ConnectAgent = connect,
  signal?: AbortSignal,
): Promise<ActivatedAgent> {
  const activation = requireActivation(store, alias);
  const verified =
    activation.source === 'managed'
      ? await verifyManagedActivation(
          store,
          activation,
          managedSecretProviders,
          connectAgent,
          signal,
        )
      : await verifyExternalActivation(
          activation,
          externalSecretProviders,
          connectAgent,
          signal,
        );
  assertIdentityMatches(
    verified.whoami,
    activation,
    'authenticated whoami',
    `agent "${activation.alias}" pinned activation`,
  );
  const boundTeamId =
    verified.whoami.credentialBinding?.bindingScope === 'team'
      ? (verified.whoami.credentialBinding.boundTeamId ?? undefined)
      : undefined;
  return {
    activation,
    config: verified.config,
    ...(boundTeamId ? { boundTeamId } : {}),
  };
}

async function verifyManagedActivation(
  store: ServeStore,
  activation: ManagedAgentActivation,
  secretProviders: SecretProviderRegistry,
  connectAgent: ConnectAgent,
  signal?: AbortSignal,
): Promise<{ config: MoltNetConfig; whoami: Whoami }> {
  const configPath = store.agentPath(activation.alias);
  const config = await readCurrentConfig(configPath);
  assertActivatedConfig(
    config,
    activation,
    configPath,
    requireConfigApiUrl(config, configPath),
    activation.apiUrl,
  );
  let agentKey: string | null;
  try {
    agentKey = await resolveAgentKey(config, secretProviders);
  } catch (cause) {
    throw verificationError(
      `could not resolve the managed agent key for "${activation.alias}"`,
      cause,
    );
  }
  if (!agentKey) {
    throw new ServeIdentityError(
      'verification_failed',
      `managed config for "${activation.alias}" has no agent_key_ref`,
    );
  }
  const whoami = await callWhoami(
    connectAgent,
    { agentKey, apiUrl: activation.apiUrl },
    configPath,
    signal,
  );
  return { config, whoami };
}

async function verifyExternalActivation(
  activation: ExternalAgentActivation,
  secretProviders: SecretProviderRegistry,
  connectAgent: ConnectAgent,
  signal?: AbortSignal,
): Promise<{ config: MoltNetConfig; whoami: Whoami }> {
  externalAgentLocation(activation.configPath);
  assertTrustedConfigApiUrl(activation.configApiUrl);
  const config = await readCurrentConfig(activation.configPath);
  assertActivatedConfig(
    config,
    activation,
    activation.configPath,
    requireTrustedConfigApiUrl(config, activation.configPath),
    activation.configApiUrl,
  );
  const effectiveApiUrl = requireTrustedApiOverride(
    activation.apiUrl,
    activation.configApiUrl,
    activation.configPath,
  );
  const whoami = await authenticateConfig(
    dirname(activation.configPath),
    effectiveApiUrl,
    secretProviders,
    connectAgent,
    signal,
  );
  return { config, whoami };
}

/** Never let request or activation metadata redirect persisted credentials. */
function requireTrustedApiOverride(
  override: string | undefined,
  configApiUrl: string,
  configPath: string,
): string {
  if (!override) return configApiUrl;
  if (override !== configApiUrl) {
    throw new ServeIdentityError(
      'verification_failed',
      `API override for ${configPath} does not match its configured endpoint`,
    );
  }
  return configApiUrl;
}

function assertActivatedConfig(
  config: MoltNetConfig,
  activation: AgentActivation,
  configPath: string,
  currentApiUrl: string,
  pinnedApiUrl: string,
): void {
  if (currentApiUrl !== pinnedApiUrl) {
    throw new ServeIdentityError(
      'verification_failed',
      `agent config at ${configPath} API endpoint does not match its pinned activation`,
    );
  }
  assertIdentityMatches(
    identityFromConfig(config),
    activation,
    configPath,
    `agent "${activation.alias}" pinned activation`,
  );
}

function requireConfigApiUrl(
  config: MoltNetConfig,
  configPath: string,
): string {
  const apiUrl = config?.endpoints?.api?.trim();
  if (!apiUrl) {
    throw new ServeIdentityError(
      'verification_failed',
      `agent config at ${configPath} is missing endpoints.api`,
    );
  }
  return apiUrl;
}

function requireTrustedConfigApiUrl(
  config: MoltNetConfig,
  configPath: string,
): string {
  const apiUrl = requireConfigApiUrl(config, configPath);
  try {
    assertTrustedConfigApiUrl(apiUrl);
    return apiUrl;
  } catch (cause) {
    throw verificationError(
      `agent config at ${configPath} has an untrusted endpoints.api`,
      cause,
    );
  }
}

async function readCurrentConfig(configPath: string): Promise<MoltNetConfig> {
  let file;
  try {
    file = await open(configPath, 'r');
  } catch (cause) {
    throw new ServeIdentityError(
      'config_not_found',
      `agent config is missing at ${configPath}`,
      { cause },
    );
  }
  let raw: string;
  try {
    const stats = await file.stat();
    if (!stats.isFile()) {
      throw new ServeIdentityError(
        'verification_failed',
        `agent config at ${configPath} must be a regular file no larger than ${MAX_CONFIG_BYTES} bytes`,
      );
    }
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_CONFIG_BYTES) {
      throw new ServeIdentityError(
        'verification_failed',
        `agent config at ${configPath} must be a regular file no larger than ${MAX_CONFIG_BYTES} bytes`,
      );
    }
    raw = buffer.toString('utf8', 0, bytesRead);
  } finally {
    await file.close();
  }
  try {
    return JSON.parse(raw) as MoltNetConfig;
  } catch (cause) {
    throw verificationError(
      `agent config is not valid JSON at ${configPath}`,
      cause,
    );
  }
}

/** Resolve the unchanged daemon CLI's root/name pair for an external config. */
export function externalAgentLocation(configPath: string): {
  agentName: string;
  agentRoot: string;
} {
  const configDir = dirname(configPath);
  const moltnetDir = dirname(configDir);
  if (
    !isAbsolute(configPath) ||
    basename(configPath) !== 'moltnet.json' ||
    basename(moltnetDir) !== '.moltnet'
  ) {
    throw new ServeIdentityError(
      'config_not_found',
      `external config must be at an absolute <agent-root>/.moltnet/<agent>/moltnet.json path`,
    );
  }
  return {
    agentName: assertStoreName(
      'external config agent name',
      basename(configDir),
    ),
    agentRoot: dirname(moltnetDir),
  };
}

async function authenticateConfig(
  configDir: string,
  apiUrl: string | undefined,
  secretProviders: SecretProviderRegistry,
  connectAgent: ConnectAgent,
  signal?: AbortSignal,
): Promise<Whoami> {
  return callWhoami(
    connectAgent,
    {
      configDir,
      ...(apiUrl ? { apiUrl } : {}),
      secretProviders,
    },
    configDir,
    signal,
  );
}

async function callWhoami(
  connectAgent: ConnectAgent,
  options: ConnectOptions,
  source: string,
  signal?: AbortSignal,
): Promise<Whoami> {
  try {
    const boundedSignal = boundedIdentitySignal(signal);
    const agent = await connectAgent({ ...options, signal: boundedSignal });
    return await agent.agents.whoami({ signal: boundedSignal });
  } catch (cause) {
    throw verificationError(
      `could not authenticate ${source} against the API`,
      cause,
    );
  }
}

function boundedIdentitySignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(IDENTITY_OPERATION_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function identityFromConfig(config: MoltNetConfig): IdentityPin {
  const identityId = config?.identity_id?.trim();
  const publicKey = config?.keys?.public_key?.trim();
  const fingerprint = config?.keys?.fingerprint?.trim();
  if (!identityId || !publicKey || !fingerprint) {
    throw new ServeIdentityError(
      'verification_failed',
      'agent config is missing canonical identity_id, keys.public_key, or keys.fingerprint',
    );
  }
  return {
    identityId,
    publicKey,
    fingerprint,
  };
}

function assertIdentityMatches(
  current: Partial<IdentityPin>,
  expected: Partial<IdentityPin>,
  currentLabel: string,
  expectedLabel: string,
): void {
  const assessment = assessIdentityPin(current, expected);
  if (!assessment.ok) {
    throw new ServeIdentityError(
      'verification_failed',
      `${currentLabel} ${assessment.label} does not match ${expectedLabel}`,
    );
  }
}

function verificationError(
  message: string,
  cause: unknown,
): ServeIdentityError {
  return new ServeIdentityError('verification_failed', message, { cause });
}

/** Non-secret projection preserving the existing `/v1` response shape. */
export function publicAgentView(
  store: ServeStore,
  activation: AgentActivation,
): Record<string, unknown> {
  if (activation.source === 'managed') {
    const config = store.readAgentConfig(activation.alias);
    return {
      kind: 'managed',
      agentName: activation.alias,
      identityId: activation.identityId,
      fingerprint: activation.fingerprint,
      apiUrl: activation.apiUrl,
      createdAt: activation.createdAt,
      hasAgentKey: Boolean(config?.agent_key_ref),
      hasPrivateKey: Boolean(config?.keys.private_key_ref),
    };
  }
  return {
    kind: 'external',
    agentName: activation.alias,
    configDir: dirname(activation.configPath),
    ...(activation.apiUrl ? { apiUrl: activation.apiUrl } : {}),
    identityId: activation.identityId,
    fingerprint: activation.fingerprint,
    createdAt: activation.createdAt,
  };
}

export function requireActivation(
  store: ServeStore,
  alias: string,
): AgentActivation {
  const activation = store.readActivation(alias);
  if (!activation) {
    throw new ServeStoreError(
      'not_found',
      `agent "${alias}" is not configured`,
    );
  }
  return activation;
}
