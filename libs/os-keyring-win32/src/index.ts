import {
  createWindowsCredentialStore,
  type WindowsCredentialStore,
} from './windows-credential.js';

const MOLTNET_SECRET_SERVICE = 'themolt.net';

export function createPlatformKeyringSecretProvider(
  credentials: WindowsCredentialStore = createWindowsCredentialStore(),
) {
  return {
    name: 'os-keyring',
    async read(key: string): Promise<string | null> {
      const value = await credentials.read(
        windowsKeyringTarget(MOLTNET_SECRET_SERVICE, key),
      );
      return value ? Buffer.from(value).toString('utf8') : null;
    },
    async write(key: string, value: string): Promise<void> {
      await credentials.write(
        windowsKeyringTarget(MOLTNET_SECRET_SERVICE, key),
        key,
        Buffer.from(value, 'utf8'),
      );
    },
    async delete(key: string): Promise<void> {
      await credentials.delete(
        windowsKeyringTarget(MOLTNET_SECRET_SERVICE, key),
      );
    },
  };
}

export function windowsKeyringTarget(service: string, key: string): string {
  return `${service}:${key}`;
}

export {
  createWindowsCredentialStore,
  WINDOWS_POWERSHELL_PATH,
  type WindowsCredentialStore,
} from './windows-credential.js';
