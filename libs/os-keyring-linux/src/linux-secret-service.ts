import {
  type ClientInterface,
  type MessageBus,
  sessionBus,
  Variant,
} from '@jellybrick/dbus-next';

const SERVICE_NAME = 'org.freedesktop.secrets';
const SERVICE_PATH = '/org/freedesktop/secrets';
const SERVICE_INTERFACE = 'org.freedesktop.Secret.Service';
const COLLECTION_INTERFACE = 'org.freedesktop.Secret.Collection';
const ITEM_INTERFACE = 'org.freedesktop.Secret.Item';
const SESSION_INTERFACE = 'org.freedesktop.Secret.Session';
const PROMPT_INTERFACE = 'org.freedesktop.Secret.Prompt';
const PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties';
const LOGIN_COLLECTION = '/org/freedesktop/secrets/collection/login';
const DEFAULT_COLLECTION = '/org/freedesktop/secrets/aliases/default';
const NO_PROMPT = '/';
const SECRET_SERVICE_TIMEOUT_MS = 30_000;

export class LinuxSecretServiceTimeoutError extends Error {
  constructor() {
    super('Linux Secret Service operation timed out');
    this.name = 'LinuxSecretServiceTimeoutError';
  }
}

type Secret = [string, Uint8Array, Uint8Array, string];

interface ServiceInterface extends ClientInterface {
  OpenSession(
    algorithm: string,
    input: Variant<string>,
  ): Promise<[Variant<unknown>, string]>;
  Unlock(paths: string[]): Promise<[string[], string]>;
}

interface PropertiesInterface extends ClientInterface {
  Get(interfaceName: string, propertyName: string): Promise<Variant<string[]>>;
}

interface CollectionInterface extends ClientInterface {
  SearchItems(attributes: Record<string, string>): Promise<string[]>;
  CreateItem(
    properties: Record<string, Variant<unknown>>,
    secret: Secret,
    replace: boolean,
  ): Promise<[string, string]>;
}

interface ItemInterface extends ClientInterface {
  GetSecret(session: string): Promise<Secret>;
  Delete(): Promise<string>;
}

interface SessionInterface extends ClientInterface {
  Close(): Promise<void>;
}

interface PromptInterface extends ClientInterface {
  Prompt(windowId: string): Promise<void>;
  once(
    event: 'Completed',
    listener: (dismissed: boolean, result: Variant<unknown>) => void,
  ): this;
  removeListener(
    event: 'Completed',
    listener: (dismissed: boolean, result: Variant<unknown>) => void,
  ): this;
}

export interface LinuxSecretStore {
  read(service: string, key: string): Promise<string | null>;
  write(service: string, key: string, value: string): Promise<void>;
  delete(service: string, key: string): Promise<void>;
}

export function createLinuxSecretStore(): LinuxSecretStore {
  return {
    read: (service, key) =>
      withSecretService((client) => client.read(service, key)),
    write: (service, key, value) =>
      withSecretService((client) => client.write(service, key, value)),
    delete: (service, key) =>
      withSecretService((client) => client.delete(service, key)),
  };
}

async function withSecretService<T>(
  operation: (client: SecretServiceClient) => Promise<T>,
): Promise<T> {
  const bus = sessionBus();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      SecretServiceClient.connect(bus).then((client) => {
        if (timedOut) throw new LinuxSecretServiceTimeoutError();
        return operation(client);
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          reject(new LinuxSecretServiceTimeoutError());
        }, SECRET_SERVICE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof LinuxSecretServiceTimeoutError) throw error;
    throw new Error('Linux Secret Service operation failed', { cause: error });
  } finally {
    if (timeout) clearTimeout(timeout);
    bus.disconnect();
  }
}

class SecretServiceClient {
  private constructor(
    private readonly bus: MessageBus,
    private readonly service: ServiceInterface,
    private readonly collectionPath: string,
  ) {}

  static async connect(bus: MessageBus): Promise<SecretServiceClient> {
    const serviceObject = await bus.getProxyObject(SERVICE_NAME, SERVICE_PATH);
    const service =
      serviceObject.getInterface<ServiceInterface>(SERVICE_INTERFACE);
    const properties =
      serviceObject.getInterface<PropertiesInterface>(PROPERTIES_INTERFACE);
    const collections = await properties.Get(SERVICE_INTERFACE, 'Collections');
    const collectionPath = collections.value.includes(LOGIN_COLLECTION)
      ? LOGIN_COLLECTION
      : DEFAULT_COLLECTION;
    return new SecretServiceClient(bus, service, collectionPath);
  }

  async read(service: string, key: string): Promise<string | null> {
    await this.unlock(this.collectionPath);
    const paths = await this.search(service, key);
    if (paths.length === 0) return null;

    const session = await this.openSession();
    try {
      const path = paths[0];
      await this.unlock(path);
      const item = await this.interfaceAt<ItemInterface>(path, ITEM_INTERFACE);
      const secret = await item.GetSecret(session.path);
      return Buffer.from(secret[2]).toString('utf8');
    } finally {
      await session.close();
    }
  }

  async write(service: string, key: string, value: string): Promise<void> {
    await this.unlock(this.collectionPath);
    const collection = await this.interfaceAt<CollectionInterface>(
      this.collectionPath,
      COLLECTION_INTERFACE,
    );
    const session = await this.openSession();
    try {
      const properties: Record<string, Variant<unknown>> = {
        [`${ITEM_INTERFACE}.Label`]: new Variant(
          's',
          `Password for '${key}' on '${service}'`,
        ),
        [`${ITEM_INTERFACE}.Attributes`]: new Variant('a{ss}', {
          service,
          username: key,
        }),
      };
      const secret: Secret = [
        session.path,
        Buffer.alloc(0),
        Buffer.from(value, 'utf8'),
        'text/plain; charset=utf8',
      ];
      const [, prompt] = await collection.CreateItem(properties, secret, true);
      await this.handlePrompt(prompt);
    } finally {
      await session.close();
    }
  }

  async delete(service: string, key: string): Promise<void> {
    await this.unlock(this.collectionPath);
    const paths = await this.search(service, key);
    for (const path of paths) {
      const item = await this.interfaceAt<ItemInterface>(path, ITEM_INTERFACE);
      await this.handlePrompt(await item.Delete());
    }
    if ((await this.search(service, key)).length !== 0) {
      throw new Error('Secret Service could not confirm deletion');
    }
  }

  private async search(service: string, key: string): Promise<string[]> {
    const collection = await this.interfaceAt<CollectionInterface>(
      this.collectionPath,
      COLLECTION_INTERFACE,
    );
    return collection.SearchItems({ service, username: key });
  }

  private async openSession(): Promise<{
    path: string;
    close: () => Promise<void>;
  }> {
    const [, path] = await this.service.OpenSession(
      'plain',
      new Variant('s', ''),
    );
    const session = await this.interfaceAt<SessionInterface>(
      path,
      SESSION_INTERFACE,
    );
    return { path, close: () => session.Close() };
  }

  private async unlock(path: string): Promise<void> {
    const [unlocked, prompt] = await this.service.Unlock([path]);
    if (unlocked.includes(path)) return;
    await this.handlePrompt(prompt);
  }

  private async handlePrompt(path: string): Promise<void> {
    if (path === NO_PROMPT) return;
    const prompt = await this.interfaceAt<PromptInterface>(
      path,
      PROMPT_INTERFACE,
    );
    await new Promise<void>((resolve, reject) => {
      const completed = (dismissed: boolean): void => {
        prompt.removeListener('Completed', completed);
        if (dismissed) reject(new Error('Secret Service prompt was dismissed'));
        else resolve();
      };
      prompt.once('Completed', completed);
      void prompt.Prompt('').catch((error: unknown) => {
        prompt.removeListener('Completed', completed);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private async interfaceAt<T extends ClientInterface>(
    path: string,
    interfaceName: string,
  ): Promise<T> {
    const object = await this.bus.getProxyObject(SERVICE_NAME, path);
    return object.getInterface<T>(interfaceName);
  }
}
