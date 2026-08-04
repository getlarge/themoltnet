export const MOLTNET_SECRET_SERVICE = 'themolt.net';
export const OS_KEYRING_SECRET_PROVIDER = 'os-keyring';

export interface KeyringSecretProvider {
  readonly name: string;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

type PlatformKeyringModule = {
  createPlatformKeyringSecretProvider(): KeyringSecretProvider;
};

export type PlatformKeyringProviderLoader = (
  platform: NodeJS.Platform,
) => Promise<KeyringSecretProvider>;

export class OSKeyringSecretProvider implements KeyringSecretProvider {
  readonly name = OS_KEYRING_SECRET_PROVIDER;
  private providerPromise: Promise<KeyringSecretProvider> | undefined;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly loadProvider: PlatformKeyringProviderLoader = loadPlatformKeyringProvider,
  ) {}

  async read(key: string): Promise<string | null> {
    return (await this.provider()).read(key);
  }

  async write(key: string, value: string): Promise<void> {
    return (await this.provider()).write(key, value);
  }

  async delete(key: string): Promise<void> {
    return (await this.provider()).delete(key);
  }

  private provider(): Promise<KeyringSecretProvider> {
    this.providerPromise ??= this.loadProvider(this.platform);
    return this.providerPromise;
  }
}

async function loadPlatformKeyringProvider(
  platform: NodeJS.Platform,
): Promise<KeyringSecretProvider> {
  let modulePromise: Promise<PlatformKeyringModule>;
  switch (platform) {
    case 'darwin':
      modulePromise = import('@themoltnet/os-keyring-darwin');
      break;
    case 'linux':
      modulePromise = import('@themoltnet/os-keyring-linux');
      break;
    case 'win32':
      modulePromise = import('@themoltnet/os-keyring-win32');
      break;
    default:
      throw new Error(`OS keyring is not supported on ${platform}`);
  }

  try {
    return (await modulePromise).createPlatformKeyringSecretProvider();
  } catch (error) {
    throw new Error(
      `OS keyring support for ${platform} is unavailable; install @themoltnet/os-keyring with optional dependencies enabled`,
      { cause: error },
    );
  }
}

export function windowsKeyringTarget(
  service: string,
  key: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return platform === 'win32' ? `${service}:${key}` : undefined;
}
