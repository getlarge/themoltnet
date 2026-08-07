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
const MACOS_TEST_KEYCHAIN_PASSWORD = 'moltnet-native-test';
let macOSKeychainDir: string | undefined;
let macOSKeychainPath: string | undefined;
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
  await execFileAsync(MACOS_SECURITY, [
    'create-keychain',
    '-p',
    MACOS_TEST_KEYCHAIN_PASSWORD,
    macOSKeychainPath,
  ]);
  await execFileAsync(MACOS_SECURITY, [
    'unlock-keychain',
    '-p',
    MACOS_TEST_KEYCHAIN_PASSWORD,
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

async function provisionMacOSCredential(key: string): Promise<void> {
  if (process.platform !== 'darwin' || !macOSKeychainPath) return;
  await execFileAsync(MACOS_SECURITY, [
    'add-generic-password',
    '-U',
    '-A',
    '-a',
    key,
    '-s',
    'themolt.net',
    '-w',
    'placeholder',
    macOSKeychainPath,
  ]);
}

describe.runIf(nativeKeyringEnabled)('native OS keyring', () => {
  it('reads a Go-written UTF-8 secret through the packed Node provider', async () => {
    const provider = new OSKeyringSecretProvider();
    const key = `oauth2/native-test/${randomUUID()}`;
    const value = 'go→node\n秘密';

    try {
      await provisionMacOSCredential(key);
      await runGoKeyringHelper({
        operation: 'write',
        key,
        value: Buffer.from(value, 'utf8').toString('base64'),
      });
      await expect(provider.read(key)).resolves.toBe(value);

      await runGoKeyringHelper({ operation: 'delete', key });
      await expect(provider.read(key)).resolves.toBeNull();
    } finally {
      await runGoKeyringHelper({ operation: 'delete', key });
    }
  }, 60_000);
});
