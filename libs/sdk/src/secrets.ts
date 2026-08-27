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

export function oauth2SecretKey(identityId: string, clientId: string): string {
  return `oauth2/${identityId}/${clientId}`;
}

export function assertOAuth2SecretReferenceBinding(
  reference: SecretReference,
  identityId: string,
  clientId: string,
): void {
  const expectedKey = oauth2SecretKey(identityId, clientId);
  const validKey =
    reference.provider === ENVIRONMENT_SECRET_PROVIDER
      ? reference.key === 'MOLTNET_CLIENT_SECRET'
      : reference.key === expectedKey;
  if (!validKey) {
    throw new Error(
      'OAuth2 secret reference is not bound to this MoltNet identity and client',
    );
  }
}
