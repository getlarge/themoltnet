import { AsyncEntry } from '@napi-rs/keyring';

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
  ) {}

  async read(key: string): Promise<string | null> {
    if (this.platform === 'win32') {
      const target = requireWindowsKeyringTarget(key, this.platform);
      const value = await this.windowsCredentials.read(target);
      return value ? Buffer.from(value).toString('utf8') : null;
    }
    const value = await new AsyncEntry(MOLTNET_SECRET_SERVICE, key).getSecret();
    if (!value) return null;
    return decodeSecret(Buffer.from(value), this.platform);
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
    await new AsyncEntry(MOLTNET_SECRET_SERVICE, key).setSecret(
      encodeSecret(value, this.platform),
    );
  }

  async delete(key: string): Promise<void> {
    if (this.platform === 'win32') {
      const target = requireWindowsKeyringTarget(key, this.platform);
      await this.windowsCredentials.delete(target);
      return;
    }
    const entry = new AsyncEntry(MOLTNET_SECRET_SERVICE, key);
    if (!(await entry.deleteCredential())) {
      throw new Error(
        'OS keyring could not confirm deletion (credential absent or backend unavailable)',
      );
    }
  }
}

function encodeSecret(value: string, platform: NodeJS.Platform): Uint8Array {
  const storedValue =
    platform === 'darwin'
      ? GO_KEYRING_BASE64_PREFIX + Buffer.from(value, 'utf8').toString('base64')
      : value;
  return Buffer.from(storedValue, 'utf8');
}

function decodeSecret(storedValue: Buffer, platform: NodeJS.Platform): string {
  const value = storedValue.toString('utf8');
  if (platform === 'darwin' && value.startsWith(GO_KEYRING_BASE64_PREFIX)) {
    return Buffer.from(
      value.slice(GO_KEYRING_BASE64_PREFIX.length),
      'base64',
    ).toString('utf8');
  }
  return value;
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
