import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { isLoopbackHostname } from '@moltnet/loopback-companion';

export const RELEASE_CONNECTION = {
  apiUrl: 'https://api.themolt.net',
  issuer: 'https://auth.themolt.net',
  publicUrl: 'https://auth.themolt.net',
  nativeClientId: 'moltnet-native',
  consoleClientId: 'moltnet-console',
};
export type ConnectionSettings = typeof RELEASE_CONNECTION;
export type ConnectionOverrides = Partial<ConnectionSettings>;
const KEYS = Object.keys(RELEASE_CONNECTION) as (keyof ConnectionSettings)[];

export function validateConnectionOverrides(
  value: unknown,
): ConnectionOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Connection settings must be an object');
  const result: ConnectionOverrides = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      !KEYS.includes(key as keyof ConnectionSettings) ||
      typeof raw !== 'string' ||
      !raw.trim()
    )
      throw new Error(`Invalid connection setting: ${key}`);
    const text = raw.trim();
    if (key.endsWith('ClientId')) {
      if (text.length > 255 || /\s/u.test(text))
        throw new Error('Client IDs must not contain whitespace');
    } else {
      const url = new URL(text);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== 'https:' &&
          !(
            url.protocol === 'http:' &&
            (key === 'issuer' || isLoopbackHostname(url.hostname))
          ))
      )
        throw new Error(
          'Connection URLs require HTTPS (HTTP is allowed only on loopback)',
        );
    }
    result[key as keyof ConnectionSettings] = text;
  }
  return result;
}

/** Local administration only. Never exposed through browser authorization. */
export class ConnectionSettingsStore {
  private readonly path: string;
  readonly environment: ConnectionOverrides;
  constructor(
    readonly root: string,
    environment: ConnectionOverrides = {},
  ) {
    this.path = join(root, 'connection-settings.json');
    this.environment = validateConnectionOverrides(environment);
  }
  view() {
    let overrides: ConnectionOverrides = {};
    try {
      overrides = validateConnectionOverrides(
        JSON.parse(readFileSync(this.path, 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return {
      defaults: RELEASE_CONNECTION,
      overrides,
      environment: this.environment,
      effective: { ...RELEASE_CONNECTION, ...overrides, ...this.environment },
    };
  }
  stateRoot(settings = this.view().effective) {
    // Explicit launch environments already select their own root. UI-managed
    // API/issuer changes use a separate namespace automatically.
    if (this.environment.apiUrl && this.environment.issuer) return this.root;
    return connectionStateRoot(this.root, settings);
  }
  save(value: unknown) {
    const overrides = validateConnectionOverrides(value);
    const current = this.view();
    for (const key of KEYS) {
      if (
        this.environment[key] !== undefined &&
        overrides[key] !== current.overrides[key]
      )
        throw new Error(`${key} is managed by the launch environment`);
      if (overrides[key] === RELEASE_CONNECTION[key]) delete overrides[key];
    }
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const effective = {
      ...RELEASE_CONNECTION,
      ...overrides,
      ...this.environment,
    };
    // Clear the destination operator before committing the new configuration.
    // A failed write may require sign-in again, but cannot select an old operator.
    rmSync(join(this.stateRoot(effective), 'operator.json'), { force: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(overrides, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    try {
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    return this.view();
  }
}

/** A custom service gets its own identities, keys and runtime configuration. */
export function connectionStateRoot(
  root: string,
  settings: ConnectionSettings,
): string {
  const identity = [
    settings.apiUrl.replace(/\/$/u, ''),
    settings.issuer.replace(/\/$/u, ''),
  ];
  if (
    identity[0] === RELEASE_CONNECTION.apiUrl &&
    identity[1] === RELEASE_CONNECTION.issuer
  )
    return root;
  const id = createHash('sha256')
    .update(JSON.stringify(identity))
    .digest('hex');
  return join(root, 'environments', id);
}
