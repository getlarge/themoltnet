export const MOLTNET_SECRET_SERVICE = 'themolt.net';
export const OS_KEYRING_SECRET_PROVIDER = 'os-keyring';

export type KeyringProbeResult = 'present' | 'absent' | 'inaccessible';

export interface KeyringSecretProviderCapabilities {
  readonly read: true;
  readonly write: boolean;
  readonly delete: boolean;
}

export interface KeyringSecretProvider {
  readonly name: string;
  readonly capabilities: KeyringSecretProviderCapabilities;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  probe(key: string): Promise<KeyringProbeResult>;
}

interface Keytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

type KeytarModule = Keytar & {
  default?: Keytar;
};

export type KeytarLoader = () => Promise<Keytar>;

const GO_KEYRING_BASE64_PREFIX = 'go-keyring-base64:';
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>([
  'darwin',
  'linux',
  'win32',
]);

export class OSKeyringSecretProvider implements KeyringSecretProvider {
  readonly name = OS_KEYRING_SECRET_PROVIDER;
  readonly capabilities: KeyringSecretProviderCapabilities = Object.freeze({
    read: true,
    write: true,
    delete: true,
  });
  private keytarPromise: Promise<Keytar> | undefined;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly loadKeytar: KeytarLoader = loadNativeKeytar,
  ) {}

  async read(key: string): Promise<string | null> {
    this.assertSupported();
    const value = await (
      await this.keytar()
    ).getPassword(MOLTNET_SECRET_SERVICE, key);
    if (value === null || this.platform !== 'darwin') return value;
    return decodeGoKeyringPassword(value);
  }

  /**
   * Store in the exact form `zalando/go-keyring` writes on each platform so
   * the Go CLI reads Node-written secrets unchanged: macOS always carries the
   * `go-keyring-base64:` prefix; Linux Secret Service and Windows Credential
   * Manager store the raw string.
   */
  async write(key: string, value: string): Promise<void> {
    this.assertSupported();
    const stored =
      this.platform === 'darwin' ? encodeGoKeyringPassword(value) : value;
    await (
      await this.keytar()
    ).setPassword(MOLTNET_SECRET_SERVICE, key, stored);
  }

  async delete(key: string): Promise<void> {
    this.assertSupported();
    await (await this.keytar()).deletePassword(MOLTNET_SECRET_SERVICE, key);
  }

  async probe(key: string): Promise<KeyringProbeResult> {
    try {
      return (await this.read(key)) ? 'present' : 'absent';
    } catch {
      return 'inaccessible';
    }
  }

  private assertSupported(): void {
    if (!SUPPORTED_PLATFORMS.has(this.platform)) {
      throw new Error(`OS keyring is not supported on ${this.platform}`);
    }
  }

  private keytar(): Promise<Keytar> {
    this.keytarPromise ??= this.loadKeytar();
    return this.keytarPromise;
  }
}

async function loadNativeKeytar(): Promise<Keytar> {
  try {
    const module = (await import('@github/keytar')) as KeytarModule;
    return module.default ?? module;
  } catch (error) {
    throw new Error('OS keyring native bindings are unavailable', {
      cause: error,
    });
  }
}

export function encodeGoKeyringPassword(value: string): string {
  return (
    GO_KEYRING_BASE64_PREFIX + Buffer.from(value, 'utf8').toString('base64')
  );
}

export function decodeGoKeyringPassword(value: string): string {
  if (!value.startsWith(GO_KEYRING_BASE64_PREFIX)) return value;
  return Buffer.from(
    value.slice(GO_KEYRING_BASE64_PREFIX.length),
    'base64',
  ).toString('utf8');
}

export function windowsKeyringTarget(
  service: string,
  key: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return platform === 'win32' ? `${service}/${key}` : undefined;
}
