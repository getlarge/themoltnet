import { readEnvironmentVariable } from './config.js';
import type { SecretReference } from './credentials.js';

export const ENVIRONMENT_SECRET_PROVIDER = 'env';
export const OS_KEYRING_SECRET_PROVIDER = 'os-keyring';
export const MOLTNET_SECRET_SERVICE = 'themolt.net';

export interface SecretProviderCapabilities {
  readonly read: true;
  readonly write: boolean;
  readonly delete: boolean;
}

export const READ_ONLY_CAPABILITIES: SecretProviderCapabilities = Object.freeze(
  { read: true, write: false, delete: false },
);

export const READ_WRITE_CAPABILITIES: SecretProviderCapabilities =
  Object.freeze({ read: true, write: true, delete: true });

/** Value-free presence check; matches the #1970 SecretProbe vocabulary. */
export type SecretProbeResult = 'present' | 'absent' | 'inaccessible';

export interface SecretProvider {
  readonly name: string;
  readonly capabilities: SecretProviderCapabilities;
  read(key: string): Promise<string | null>;
  /** Present only when `capabilities.write` is true. */
  write?(key: string, value: string): Promise<void>;
  /** Present only when `capabilities.delete` is true. Missing keys are not errors. */
  delete?(key: string): Promise<void>;
  /** Value-free presence check; must not throw and must not return the value. */
  probe(key: string): Promise<SecretProbeResult>;
}

export class SecretConflictError extends Error {
  readonly code = 'SECRET_CONFLICT';
  constructor(providerName: string) {
    super(
      `Secret provider ${JSON.stringify(providerName)} already contains a different secret for this key`,
    );
    this.name = 'SecretConflictError';
  }
}

/**
 * `ensure` failed after the destination may have been mutated. `changed` is
 * true when the write succeeded but read-back verification did not, so the
 * caller can roll the destination back.
 */
export class SecretEnsureError extends Error {
  readonly code = 'SECRET_ENSURE_FAILED';
  constructor(
    providerName: string,
    readonly changed: boolean,
    detail: string,
  ) {
    super(`Secret provider ${JSON.stringify(providerName)}: ${detail}`);
    this.name = 'SecretEnsureError';
  }
}

export class SecretProviderReadOnlyError extends Error {
  readonly code = 'SECRET_PROVIDER_READ_ONLY';
  constructor(providerName: string, operation: 'write' | 'delete') {
    super(
      `Secret provider ${JSON.stringify(providerName)} does not support ${operation}`,
    );
    this.name = 'SecretProviderReadOnlyError';
  }
}

interface LocatedProvider {
  providerName: string;
  key: string;
  provider: SecretProvider;
}

export class SecretProviderRegistry {
  readonly #providers = new Map<string, SecretProvider>();
  readonly #locks = new Map<string, Promise<unknown>>();

  register(provider: SecretProvider): this {
    const name = provider.name.trim();
    if (!name) {
      throw new Error('Secret provider name must not be empty');
    }
    this.#providers.set(name, provider);
    return this;
  }

  get(name: string): SecretProvider | undefined {
    return this.#providers.get(name);
  }

  #require(reference: SecretReference): LocatedProvider {
    const providerName = reference.provider.trim();
    const key = reference.key.trim();
    if (!providerName || !key) {
      throw new Error('Secret reference requires provider and key');
    }
    const provider = this.get(providerName);
    if (!provider) {
      throw new Error(
        `Secret provider ${JSON.stringify(providerName)} is not registered`,
      );
    }
    return { providerName, key, provider };
  }

  async resolve(reference: SecretReference): Promise<string> {
    const { providerName, key, provider } = this.#require(reference);
    const value = await provider.read(key);
    if (!value) {
      throw new Error(
        `Secret provider ${JSON.stringify(providerName)} has no value for the requested key`,
      );
    }
    return value;
  }

  /**
   * Serialize mutations per provider/key within this process. The Go CLI
   * holds an advisory `flock` for the same operation; Node has no portable
   * `flock`, so cross-process exclusion against `moltnet` is not provided.
   */
  #serialized<T>(providerName: string, key: string, work: () => Promise<T>) {
    const scope = `${providerName}\0${key}`;
    const previous = this.#locks.get(scope) ?? Promise.resolve();
    const run = previous.then(work, work);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.#locks.set(scope, settled);
    void settled.then(() => {
      if (this.#locks.get(scope) === settled) this.#locks.delete(scope);
    });
    return run;
  }

  /**
   * Store `value` only when the destination is absent or already equal, then
   * read it back. Mirrors the Go registry's `Ensure`: a verification failure
   * after a successful write surfaces as `SecretEnsureError` with
   * `changed === true` so the caller can roll back.
   */
  ensure(
    reference: SecretReference,
    value: string,
  ): Promise<{ changed: boolean }> {
    if (!value) {
      return Promise.reject(new Error('Secret value is required'));
    }
    const { providerName, key, provider } = this.#require(reference);
    if (!provider.capabilities.write || !provider.write) {
      return Promise.reject(
        new SecretProviderReadOnlyError(providerName, 'write'),
      );
    }
    const write = provider.write.bind(provider);
    return this.#serialized(providerName, key, async () => {
      const existing = await provider.read(key);
      if (existing === value) {
        return { changed: false };
      }
      if (existing) {
        throw new SecretConflictError(providerName);
      }
      await write(key, value);
      let verified: string | null;
      try {
        verified = await provider.read(key);
      } catch (cause) {
        const error = new SecretEnsureError(
          providerName,
          true,
          'could not verify the stored value',
        );
        error.cause = cause;
        throw error;
      }
      if (verified !== value) {
        throw new SecretEnsureError(
          providerName,
          true,
          'stored value does not match',
        );
      }
      return { changed: true };
    });
  }

  delete(reference: SecretReference): Promise<void> {
    const { providerName, key, provider } = this.#require(reference);
    if (!provider.capabilities.delete || !provider.delete) {
      return Promise.reject(
        new SecretProviderReadOnlyError(providerName, 'delete'),
      );
    }
    const remove = provider.delete.bind(provider);
    return this.#serialized(providerName, key, () => remove(key));
  }

  /** Never throws and never returns the value. */
  async probe(reference: SecretReference): Promise<SecretProbeResult> {
    let located: LocatedProvider;
    try {
      located = this.#require(reference);
    } catch {
      return 'inaccessible';
    }
    try {
      return await located.provider.probe(located.key);
    } catch {
      return 'inaccessible';
    }
  }
}

export class EnvironmentSecretProvider implements SecretProvider {
  readonly name = ENVIRONMENT_SECRET_PROVIDER;
  readonly capabilities = READ_ONLY_CAPABILITIES;

  constructor(
    private readonly readValue: (
      key: string,
    ) => string | undefined = readEnvironmentVariable,
  ) {}

  read(key: string): Promise<string | null> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return Promise.reject(
        new Error('Environment secret key must be a variable name'),
      );
    }
    return Promise.resolve(this.readValue(key) || null);
  }

  async probe(key: string): Promise<SecretProbeResult> {
    try {
      return (await this.read(key)) ? 'present' : 'absent';
    } catch {
      return 'inaccessible';
    }
  }
}

export function createDefaultSecretProviderRegistry(): SecretProviderRegistry {
  return new SecretProviderRegistry().register(new EnvironmentSecretProvider());
}

/**
 * MoltNet-owned credential kinds whose provider key shape is fixed by the
 * binding table below. Consumers that own other credentials (for example
 * `@themoltnet/github-agent` for GitHub App private keys) describe their
 * binding with {@link SecretReferenceBinding} and check it through
 * {@link assertSecretReferenceBoundTo} instead of extending this table.
 */
export type CredentialKind =
  | 'oauth2-client-secret'
  | 'identity-seed'
  | 'agent-key';

export interface CredentialBindingIds {
  identityId?: string;
  clientId?: string;
  fingerprint?: string;
}

/**
 * Describes which reference keys may resolve one credential: the canonical
 * provider key, the fixed environment variable for the `env` provider (or
 * `undefined` when `env` is not allowed), and the message raised for any
 * other key.
 */
export interface SecretReferenceBinding {
  canonicalKey: string;
  envKey?: string;
  description: string;
}

/**
 * A reference must name this credential's own secret: the canonical key, the
 * fixed environment variable for `env`, or — for `file`, whose orchestrators
 * (systemd) forbid `/` in credential IDs — the flattened `.`-joined form.
 */
export function assertSecretReferenceBoundTo(
  reference: SecretReference,
  binding: SecretReferenceBinding,
): void {
  const valid =
    reference.provider === ENVIRONMENT_SECRET_PROVIDER
      ? binding.envKey !== undefined && reference.key === binding.envKey
      : reference.key === binding.canonicalKey ||
        (reference.provider === 'file' &&
          reference.key === binding.canonicalKey.replaceAll('/', '.'));
  if (!valid) {
    throw new Error(binding.description);
  }
}

/** Environment variable each kind may be read from through the `env` provider. */
export const CREDENTIAL_ENV_KEYS: Readonly<Record<CredentialKind, string>> =
  Object.freeze({
    'oauth2-client-secret': 'MOLTNET_CLIENT_SECRET',
    'identity-seed': 'MOLTNET_PRIVATE_KEY',
    'agent-key': 'MOLTNET_AGENT_KEY',
  });

const BINDING_MESSAGES: Readonly<Record<CredentialKind, string>> =
  Object.freeze({
    'oauth2-client-secret':
      'OAuth2 secret reference is not bound to this MoltNet identity and client',
    'identity-seed':
      'Identity seed reference is not bound to this MoltNet identity',
    'agent-key': 'Agent key reference is not bound to this MoltNet identity',
  });

export function oauth2SecretKey(identityId: string, clientId: string): string {
  return `oauth2/${identityId}/${clientId}`;
}

export function identitySeedKey(fingerprint: string): string {
  return `identity/${fingerprint}/seed`;
}

export function agentKeyKey(identityId: string): string {
  return `agent-key/${identityId}`;
}

const PROVIDER_NAME = /^[a-z][a-z0-9-]*$/;
const SECRET_REFERENCE_MESSAGE =
  'Secret reference must be <provider>:<key> with a lowercase provider name';

function normalizeSecretReference(reference: SecretReference): SecretReference {
  const provider = reference.provider.trim();
  const key = reference.key.trim();
  if (!PROVIDER_NAME.test(provider) || !key) {
    throw new Error(SECRET_REFERENCE_MESSAGE);
  }
  return { provider, key };
}

/**
 * Parse the `<provider>:<key>` form used by environment references such as
 * `MOLTNET_AGENT_KEY_REF=file:agent-key.identity-1`. The first colon splits.
 */
export function parseSecretReferenceString(value: string): SecretReference {
  const trimmed = value.trim();
  const separator = trimmed.indexOf(':');
  const provider = separator > 0 ? trimmed.slice(0, separator) : '';
  const key = separator > 0 ? trimmed.slice(separator + 1) : '';
  return normalizeSecretReference({ provider, key });
}

/** Format a structured secret reference as the canonical `<provider>:<key>`. */
export function formatSecretReferenceString(
  reference: SecretReference,
): string {
  const { provider, key } = normalizeSecretReference(reference);
  return `${provider}:${key}`;
}

function requireId(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Credential binding requires ${name}`);
  }
  return trimmed;
}

/** Canonical provider key for a credential kind bound to this agent. */
export function expectedSecretKey(
  kind: CredentialKind,
  ids: CredentialBindingIds,
): string {
  switch (kind) {
    case 'oauth2-client-secret':
      return oauth2SecretKey(
        requireId(ids.identityId, 'identityId'),
        requireId(ids.clientId, 'clientId'),
      );
    case 'identity-seed':
      return identitySeedKey(requireId(ids.fingerprint, 'fingerprint'));
    case 'agent-key':
      return agentKeyKey(requireId(ids.identityId, 'identityId'));
  }
}

/** Binding check for a MoltNet-owned credential kind from the table above. */
export function assertSecretReferenceBinding(
  kind: CredentialKind,
  reference: SecretReference,
  ids: CredentialBindingIds,
): void {
  const canonicalKey = expectedSecretKey(kind, ids);
  if (
    kind === 'agent-key' &&
    reference.provider === ENVIRONMENT_SECRET_PROVIDER
  ) {
    // MOLTNET_AGENT_KEY selects environment (configless) mode before any
    // config is read, so a config-bound env reference could never be
    // resolved through the bound path — reject it instead of advertising it.
    throw new Error(
      'agent_key_ref cannot use the env provider; set MOLTNET_AGENT_KEY directly or reference a keyring/file secret',
    );
  }
  assertSecretReferenceBoundTo(reference, {
    canonicalKey,
    envKey: CREDENTIAL_ENV_KEYS[kind],
    description: BINDING_MESSAGES[kind],
  });
}

export function assertOAuth2SecretReferenceBinding(
  reference: SecretReference,
  identityId: string,
  clientId: string,
): void {
  assertSecretReferenceBinding('oauth2-client-secret', reference, {
    identityId,
    clientId,
  });
}
