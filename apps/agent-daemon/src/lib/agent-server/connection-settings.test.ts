import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ConnectionSettingsStore,
  connectionStateRoot,
  RELEASE_CONNECTION,
} from './connection-settings.js';

const roots: string[] = [];
function root() {
  const path = mkdtempSync(join(tmpdir(), 'connection-settings-'));
  roots.push(path);
  return path;
}
afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe('local connection settings', () => {
  it('starts from release defaults and stores only overrides', () => {
    const path = root();
    const store = new ConnectionSettingsStore(path);
    expect(store.view().effective).toEqual(RELEASE_CONNECTION);
    store.save({ ...RELEASE_CONNECTION, nativeClientId: 'custom-native' });
    expect(
      JSON.parse(readFileSync(join(path, 'connection-settings.json'), 'utf8')),
    ).toEqual({ nativeClientId: 'custom-native' });
    expect(
      new ConnectionSettingsStore(path).view().effective.nativeClientId,
    ).toBe('custom-native');
    expect(store.save({}).effective).toEqual(RELEASE_CONNECTION);
  });
  it('preserves launch overrides and rejects edits to managed fields', () => {
    const store = new ConnectionSettingsStore(root(), {
      apiUrl: 'http://localhost:8080',
    });
    expect(store.view().effective.apiUrl).toBe('http://localhost:8080');
    expect(() => store.save({ apiUrl: 'https://another.example' })).toThrow(
      'managed',
    );
    expect(store.save({}).effective.apiUrl).toBe('http://localhost:8080');
  });
  it('isolates service state and requires fresh operator sign-in after switching back', () => {
    const path = root();
    const store = new ConnectionSettingsStore(path);
    writeFileSync(
      join(path, 'operator.json'),
      '{"issuer":"original","subject":"human"}',
    );
    const changed = store.save({ apiUrl: 'https://api.example' });
    expect(store.stateRoot()).not.toBe(path);
    expect(readFileSync(join(path, 'operator.json'), 'utf8')).toContain(
      'human',
    );
    expect(connectionStateRoot(path, changed.effective)).toBe(
      store.stateRoot(),
    );
    store.save({});
    expect(store.stateRoot()).toBe(path);
    expect(() => readFileSync(join(path, 'operator.json'))).toThrow();
  });
  it.each([
    'http://api.example',
    'https://user:password@api.example',
    'https://api.example/#fragment',
  ])('rejects unsafe API endpoint %s', (apiUrl) => {
    expect(() =>
      new ConnectionSettingsStore(root()).save({ apiUrl }),
    ).toThrow();
  });
  it('fails visibly for malformed persisted settings', () => {
    const path = root();
    writeFileSync(join(path, 'connection-settings.json'), '{broken');
    expect(() => new ConnectionSettingsStore(path).view()).toThrow();
  });
});
