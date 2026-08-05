const MOLTNET_SECRET_SERVICE = 'themolt.net';

interface WindowsKeytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export function createPlatformKeyringSecretProvider(keychain?: WindowsKeytar) {
  const keychainPromise = keychain
    ? Promise.resolve(keychain)
    : loadWindowsKeytar();
  return {
    name: 'os-keyring',
    async read(key: string): Promise<string | null> {
      return (await keychainPromise).getPassword(MOLTNET_SECRET_SERVICE, key);
    },
    async write(key: string, value: string): Promise<void> {
      await (
        await keychainPromise
      ).setPassword(MOLTNET_SECRET_SERVICE, key, value);
    },
    async delete(key: string): Promise<void> {
      const resolvedKeychain = await keychainPromise;
      await resolvedKeychain.deletePassword(MOLTNET_SECRET_SERVICE, key);
      if (
        (await resolvedKeychain.getPassword(MOLTNET_SECRET_SERVICE, key)) !==
        null
      ) {
        throw new Error(
          'Windows Credential Manager could not confirm deletion',
        );
      }
    },
  };
}

async function loadWindowsKeytar(): Promise<WindowsKeytar> {
  const module = await import('@github/keytar');
  return (module as { default?: WindowsKeytar }).default ?? module;
}

export function windowsKeyringTarget(service: string, key: string): string {
  return `${service}/${key}`;
}
