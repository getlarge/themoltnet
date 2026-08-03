import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OSKeyringSecretProvider } from '../src/index.js';

const execFileAsync = promisify(execFile);
const MACOS_SECURITY = '/usr/bin/security';
let macOSKeychainDir: string | undefined;
let macOSKeychainPath: string | undefined;
let macOSKeychainPassword: string | undefined;
let originalMacOSDefaultKeychain: string | undefined;
let originalMacOSKeychainList: string[] = [];

type HelperRequest = {
  operation: 'read' | 'write' | 'delete';
  key: string;
  value?: string;
};

type HelperResponse = { found?: boolean; value?: string };

const nativeKeyringEnabled =
  process.env.MOLTNET_RUN_NATIVE_KEYRING_TESTS === '1' &&
  (process.platform === 'darwin' ||
    process.platform === 'linux' ||
    process.platform === 'win32');

beforeAll(async () => {
  if (!nativeKeyringEnabled || process.platform !== 'darwin') return;
  const defaultResult = await execFileAsync(MACOS_SECURITY, [
    'default-keychain',
    '-d',
    'user',
  ]);
  originalMacOSDefaultKeychain = unquoteKeychainPath(defaultResult.stdout);
  const listResult = await execFileAsync(MACOS_SECURITY, [
    'list-keychains',
    '-d',
    'user',
  ]);
  originalMacOSKeychainList = Array.from(
    listResult.stdout.matchAll(/"([^"]+)"/g),
    (match) => match[1],
  );

  macOSKeychainDir = await mkdtemp(join(tmpdir(), 'moltnet-keyring-test-'));
  macOSKeychainPath = join(macOSKeychainDir, 'test.keychain-db');
  macOSKeychainPassword = randomUUID();
  await execFileAsync(MACOS_SECURITY, [
    'create-keychain',
    '-p',
    macOSKeychainPassword,
    macOSKeychainPath,
  ]);
  await execFileAsync(MACOS_SECURITY, [
    'unlock-keychain',
    '-p',
    macOSKeychainPassword,
    macOSKeychainPath,
  ]);
  await execFileAsync(MACOS_SECURITY, [
    'set-keychain-settings',
    '-lut',
    '21600',
    macOSKeychainPath,
  ]);
  await execFileAsync(MACOS_SECURITY, [
    'list-keychains',
    '-d',
    'user',
    '-s',
    macOSKeychainPath,
  ]);
  await execFileAsync(MACOS_SECURITY, [
    'default-keychain',
    '-d',
    'user',
    '-s',
    macOSKeychainPath,
  ]);
});

afterAll(async () => {
  if (process.platform !== 'darwin' || !macOSKeychainPath) return;
  if (originalMacOSKeychainList.length > 0) {
    await execFileAsync(MACOS_SECURITY, [
      'list-keychains',
      '-d',
      'user',
      '-s',
      ...originalMacOSKeychainList,
    ]);
  }
  if (originalMacOSDefaultKeychain) {
    await execFileAsync(MACOS_SECURITY, [
      'default-keychain',
      '-d',
      'user',
      '-s',
      originalMacOSDefaultKeychain,
    ]);
  }
  await execFileAsync(MACOS_SECURITY, [
    'delete-keychain',
    macOSKeychainPath,
  ]).catch(() => undefined);
  if (macOSKeychainDir) await rm(macOSKeychainDir, { recursive: true });
});

function unquoteKeychainPath(value: string): string {
  return value.trim().replace(/^"|"$/g, '');
}

async function runGoKeyringHelper(
  request: HelperRequest,
): Promise<HelperResponse> {
  return new Promise((resolvePromise, reject) => {
    const cwd = resolve(import.meta.dirname, '../../../apps/moltnet-cli');
    const child = spawn('go', ['run', './testdata/keyring-interop'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Go keyring helper failed: ${Buffer.concat(stderr).toString('utf8').trim() || `exit ${code}`}`,
          ),
        );
        return;
      }
      resolvePromise(JSON.parse(Buffer.concat(stdout).toString('utf8')));
    });
    child.stdin.end(JSON.stringify(request));
  });
}

describe.runIf(nativeKeyringEnabled)('native OS keyring', () => {
  it('round-trips UTF-8 secrets through the Node keyring library', async () => {
    const provider = new OSKeyringSecretProvider();
    const key = `oauth2/native-test/${randomUUID()}`;
    const value = 'node-keyring-秘密';

    try {
      await provider.write(key, value);
      await expect(provider.read(key)).resolves.toBe(value);
      await provider.delete(key);
      await expect(provider.read(key)).resolves.toBeNull();
    } finally {
      await provider.delete(key).catch(() => undefined);
    }
  }, 60_000);

  it('round-trips UTF-8 secrets through the Go keyring library', async () => {
    const key = `oauth2/native-test/${randomUUID()}`;
    const value = 'go-keyring-秘密';

    try {
      await runGoKeyringHelper({
        operation: 'write',
        key,
        value: Buffer.from(value, 'utf8').toString('base64'),
      });
      const readByGo = await runGoKeyringHelper({ operation: 'read', key });
      expect(readByGo.found).toBe(true);
      expect(Buffer.from(readByGo.value!, 'base64').toString('utf8')).toBe(
        value,
      );

      await runGoKeyringHelper({ operation: 'delete', key });
      const deleted = await runGoKeyringHelper({ operation: 'read', key });
      expect(deleted.found ?? false).toBe(false);
    } finally {
      await runGoKeyringHelper({ operation: 'delete', key });
    }
  }, 60_000);

  it.runIf(process.platform !== 'darwin')(
    'round-trips UTF-8 secrets between Go and the Node keyring library',
    async () => {
      const provider = new OSKeyringSecretProvider();
      const key = `oauth2/native-test/${randomUUID()}`;
      const fromGo = 'go→node-秘密';
      const fromNode = 'node→go-credential';

      try {
        await runGoKeyringHelper({
          operation: 'write',
          key,
          value: Buffer.from(fromGo, 'utf8').toString('base64'),
        });
        await expect(provider.read(key)).resolves.toBe(fromGo);

        await provider.write(key, fromNode);
        const readByGo = await runGoKeyringHelper({ operation: 'read', key });
        expect(readByGo.found).toBe(true);
        expect(Buffer.from(readByGo.value!, 'base64').toString('utf8')).toBe(
          fromNode,
        );

        await provider.delete(key);
        const deleted = await runGoKeyringHelper({ operation: 'read', key });
        expect(deleted.found ?? false).toBe(false);
      } finally {
        await runGoKeyringHelper({ operation: 'delete', key });
      }
    },
    60_000,
  );
});
