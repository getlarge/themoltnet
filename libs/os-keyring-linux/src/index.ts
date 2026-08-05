import {
  createLinuxSecretStore,
  type LinuxSecretStore,
} from './linux-secret-service.js';

const MOLTNET_SECRET_SERVICE = 'themolt.net';

export function createPlatformKeyringSecretProvider(
  secrets: LinuxSecretStore = createLinuxSecretStore(),
) {
  return {
    name: 'os-keyring',
    read: (key: string) => secrets.read(MOLTNET_SECRET_SERVICE, key),
    write: (key: string, value: string) =>
      secrets.write(MOLTNET_SECRET_SERVICE, key, value),
    delete: (key: string) => secrets.delete(MOLTNET_SECRET_SERVICE, key),
  };
}

export {
  createLinuxSecretStore,
  LinuxSecretServiceTimeoutError,
  type LinuxSecretStore,
} from './linux-secret-service.js';
