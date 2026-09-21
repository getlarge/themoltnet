import {
  chmod,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  NATIVE_CLIENT_ORIGIN,
  NativeGrantService,
} from './native-grant-service.js';
import { validateNativeSocket } from './native-socket.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';
import { cleanupAll, fixture } from './server-test-harness.js';

const directories: string[] = [];
afterEach(async () => {
  await cleanupAll();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function directory() {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'mn-'));
  directories.push(path);
  await chmod(path, 0o700);
  return path;
}

function get(
  path: string,
  token?: string,
  origin = NATIVE_CLIENT_ORIGIN,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: path,
        path: '/health',
        headers: {
          host: '127.0.0.1',
          origin,
          ...(token ? { [AGENT_SERVER_TOKEN_HEADER]: token } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('private native socket', () => {
  it('serves the native grant on an actual socket and rejects missing, invalid and browser credentials', async () => {
    const socket = join(await directory(), 'control.sock');
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('native-secret');
    const { app } = await fixture({ nativeGrant, nativeOnly: true });
    await validateNativeSocket(socket);
    await app.listen({ path: socket });
    expect(await get(socket, 'native-secret')).toBe(200);
    expect(await get(socket)).toBe(401);
    expect(await get(socket, 'incorrect')).toBe(401);
    expect(
      await get(socket, 'native-secret', 'https://console.themolt.net'),
    ).toBe(401);
  });

  it('limits rejected native requests without spending the valid grant budget', async () => {
    const socket = join(await directory(), 'control.sock');
    const nativeGrant = new NativeGrantService();
    nativeGrant.grantNative('native-secret');
    const { app } = await fixture({
      nativeGrant,
      nativeOnly: true,
      rateLimitMax: 1,
    });
    await app.listen({ path: socket });
    expect(await get(socket, 'incorrect')).toBe(401);
    expect(await get(socket, 'incorrect')).toBe(429);
    expect(await get(socket, 'native-secret')).toBe(200);
    expect(await get(socket, 'native-secret')).toBe(429);
  });

  it('refuses an occupied path without removing it', async () => {
    const socket = join(await directory(), 'control.sock');
    await writeFile(socket, 'preserve');
    await expect(validateNativeSocket(socket)).rejects.toThrow(
      'already exists',
    );
  });

  it('refuses public directories and symlinked directories', async () => {
    const root = await directory();
    await chmod(root, 0o755);
    await expect(
      validateNativeSocket(join(root, 'control.sock')),
    ).rejects.toThrow('mode 755; expected 700');
    await chmod(root, 0o700);
    const alias = join(await directory(), 'link');
    await symlink(root, alias);
    await expect(
      validateNativeSocket(join(alias, 'control.sock')),
    ).rejects.toThrow('contains a symlink');
  });

  it('refuses relative and overlong socket paths', async () => {
    await expect(validateNativeSocket('control.sock')).rejects.toThrow(
      'absolute',
    );
    await expect(validateNativeSocket('/' + 'x'.repeat(100))).rejects.toThrow(
      '100 bytes',
    );
  });
});
