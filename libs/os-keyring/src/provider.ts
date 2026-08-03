import {
  createLinuxSecretStore,
  type LinuxSecretStore,
} from './linux-secret-service.js';
import {
  createWindowsCredentialStore,
  type WindowsCredentialStore,
} from './windows-credential.js';

export const MOLTNET_SECRET_SERVICE = 'themolt.net';
export const OS_KEYRING_SECRET_PROVIDER = 'os-keyring';
const GO_KEYRING_BASE64_PREFIX = 'go-keyring-base64:';

export interface KeyringSecretProvider {
  readonly name: string;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class OSKeyringSecretProvider implements KeyringSecretProvider {
  readonly name = OS_KEYRING_SECRET_PROVIDER;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly windowsCredentials: WindowsCredentialStore = createWindowsCredentialStore(),
    private readonly linuxSecrets: LinuxSecretStore = createLinuxSecretStore(),
  ) {}

  async read(key: string): Promise<string | null> {
    if (this.platform === 'win32') {
      const target = requireWindowsKeyringTarget(key, this.platform);
      const value = await this.windowsCredentials.read(target);
      return value ? Buffer.from(value).toString('utf8') : null;
    }
    if (this.platform === 'linux') {
      return this.linuxSecrets.read(MOLTNET_SECRET_SERVICE, key);
    }
    if (this.platform === 'darwin') {
      const value = await (
        await loadMacOSKeytar()
      ).getPassword(MOLTNET_SECRET_SERVICE, key);
      return value ? decodeGoKeyringPassword(value) : null;
    }
    const value = await (await createAsyncEntry(key)).getPassword();
    return value || null;
  }

  async write(key: string, value: string): Promise<void> {
    if (this.platform === 'win32') {
      const target = requireWindowsKeyringTarget(key, this.platform);
      await this.windowsCredentials.write(
        target,
        key,
        Buffer.from(value, 'utf8'),
      );
      return;
    }
    if (this.platform === 'linux') {
      await this.linuxSecrets.write(MOLTNET_SECRET_SERVICE, key, value);
      return;
    }
    if (this.platform === 'darwin') {
      await (
        await loadMacOSKeytar()
      ).setPassword(
        MOLTNET_SECRET_SERVICE,
        key,
        encodeGoKeyringPassword(value),
      );
      return;
    }
    await (await createAsyncEntry(key)).setPassword(value);
  }

  async delete(key: string): Promise<void> {
    if (this.platform === 'win32') {
      const target = requireWindowsKeyringTarget(key, this.platform);
      await this.windowsCredentials.delete(target);
      return;
    }
    if (this.platform === 'linux') {
      await this.linuxSecrets.delete(MOLTNET_SECRET_SERVICE, key);
      return;
    }
    if (this.platform === 'darwin') {
      const keytar = await loadMacOSKeytar();
      await keytar.deletePassword(MOLTNET_SECRET_SERVICE, key);
      if ((await keytar.getPassword(MOLTNET_SECRET_SERVICE, key)) !== null) {
        throw new Error('macOS Keychain could not confirm deletion');
      }
      return;
    }
    const entry = await createAsyncEntry(key);
    if (!(await entry.deleteCredential())) {
      throw new Error(
        'OS keyring could not confirm deletion (credential absent or backend unavailable)',
      );
    }
  }
}

async function createAsyncEntry(key: string) {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  return new AsyncEntry(MOLTNET_SECRET_SERVICE, key);
}

interface MacOSKeytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

async function loadMacOSKeytar() {
  const module = await import('@github/keytar');
  return (module as { default?: MacOSKeytar }).default ?? module;
}

function encodeGoKeyringPassword(value: string): string {
  return (
    GO_KEYRING_BASE64_PREFIX + Buffer.from(value, 'utf8').toString('base64')
  );
}

function decodeGoKeyringPassword(value: string): string {
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
  return platform === 'win32' ? `${service}:${key}` : undefined;
}

function requireWindowsKeyringTarget(
  key: string,
  platform: NodeJS.Platform,
): string {
  const target = windowsKeyringTarget(MOLTNET_SECRET_SERVICE, key, platform);
  if (!target) {
    throw new Error(
      'Windows credential target requested on a non-Windows host',
    );
  }
  return target;
}
