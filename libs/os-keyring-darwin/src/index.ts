const MOLTNET_SECRET_SERVICE = 'themolt.net';
const GO_KEYRING_BASE64_PREFIX = 'go-keyring-base64:';

interface MacOSKeytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export function createPlatformKeyringSecretProvider(keychain?: MacOSKeytar) {
  const keychainPromise = keychain
    ? Promise.resolve(keychain)
    : loadMacOSKeytar();
  return {
    name: 'os-keyring',
    async read(key: string): Promise<string | null> {
      const value = await (
        await keychainPromise
      ).getPassword(MOLTNET_SECRET_SERVICE, key);
      return value ? decodeGoKeyringPassword(value) : null;
    },
    async write(key: string, value: string): Promise<void> {
      await (
        await keychainPromise
      ).setPassword(
        MOLTNET_SECRET_SERVICE,
        key,
        encodeGoKeyringPassword(value),
      );
    },
    async delete(key: string): Promise<void> {
      const resolvedKeychain = await keychainPromise;
      await resolvedKeychain.deletePassword(MOLTNET_SECRET_SERVICE, key);
      if (
        (await resolvedKeychain.getPassword(MOLTNET_SECRET_SERVICE, key)) !==
        null
      ) {
        throw new Error('macOS Keychain could not confirm deletion');
      }
    },
  };
}

async function loadMacOSKeytar(): Promise<MacOSKeytar> {
  const module = await import('@github/keytar');
  return (module as { default?: MacOSKeytar }).default ?? module;
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
