import {
  chmod,
  mkdir,
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
import { cleanupAll, fixture, registerCleanup } from './server-test-harness.js';

afterEach(cleanupAll);
async function directory() {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'mn-'));
  registerCleanup(() => rm(path, { recursive: true, force: true }));
  await chmod(path, 0o700);
  return path;
}

function get(
  path: string,
  token?: string,
  origin = NATIVE_CLIENT_ORIGIN,
  requestPath = '/health',
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: path,
        path: requestPath,
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
      await get(socket, undefined, NATIVE_CLIENT_ORIGIN, '/v1/providers'),
    ).toBe(401);
    expect(
      await get(socket, 'native-secret', 'https://console.themolt.net'),
    ).toBe(403);
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

  it('refuses a non-directory parent and a symlinked ancestor', async () => {
    const root = await directory();
    const file = join(root, 'file');
    await writeFile(file, 'not a directory');
    await expect(
      validateNativeSocket(join(file, 'control.sock')),
    ).rejects.toThrow('not a directory');

    const realAncestor = join(root, 'real');
    await mkdir(realAncestor, { mode: 0o700 });
    const parent = join(realAncestor, 'private');
    await mkdir(parent, { mode: 0o700 });
    const alias = join(root, 'alias');
    await symlink(realAncestor, alias);
    await expect(
      validateNativeSocket(join(alias, 'private', 'control.sock')),
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
