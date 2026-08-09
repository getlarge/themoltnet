export const MOLTNET_SECRET_SERVICE = 'themolt.net';
export const OS_KEYRING_SECRET_PROVIDER = 'os-keyring';

export interface KeyringSecretProvider {
  readonly name: string;
  read(key: string): Promise<string | null>;
}

interface Keytar {
  getPassword(service: string, account: string): Promise<string | null>;
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
  private keytarPromise: Promise<Keytar> | undefined;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly loadKeytar: KeytarLoader = loadNativeKeytar,
  ) {}

  async read(key: string): Promise<string | null> {
    if (!SUPPORTED_PLATFORMS.has(this.platform)) {
      throw new Error(`OS keyring is not supported on ${this.platform}`);
    }
    const value = await (
      await this.keytar()
    ).getPassword(MOLTNET_SECRET_SERVICE, key);
    if (value === null || this.platform !== 'darwin') return value;
    return decodeGoKeyringPassword(value);
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
