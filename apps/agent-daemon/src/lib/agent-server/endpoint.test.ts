import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OPERATOR_OAUTH } from '@moltnet/models';
import { resolveStoreRoot } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  defaultAgentServerPort,
  publishAgentServerEndpoint,
  readAgentServerEndpoint,
} from './endpoint.js';

const roots: string[] = [];
function freshRoot() {
  const root = mkdtempSync(join(tmpdir(), 'endpoint-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('per-store daemon discovery', () => {
  it('assigns an isolated port even when the default config directory is broken', () => {
    const home = freshRoot();
    vi.stubEnv('HOME', home);
    writeFileSync(join(home, '.config'), 'fixture');
    expect(defaultAgentServerPort(freshRoot())).toBe(0);
  });
  it('preserves the default port and assigns isolated roots an ephemeral port', () => {
    expect(defaultAgentServerPort(resolveStoreRoot({ env: {} }))).toBe(
      OPERATOR_OAUTH.serverPort,
    );
    expect(defaultAgentServerPort(freshRoot())).toBe(0);
  });
  it('keeps independent endpoints and removes only the owning instance', () => {
    const firstRoot = freshRoot();
    const secondRoot = freshRoot();
    const first = publishAgentServerEndpoint(
      firstRoot,
      'http://127.0.0.1:41001',
    );
    const second = publishAgentServerEndpoint(
      secondRoot,
      'http://127.0.0.1:41002',
    );
    expect(readAgentServerEndpoint(firstRoot)?.url).toBe(
      'http://127.0.0.1:41001',
    );
    expect(readAgentServerEndpoint(secondRoot)?.url).toBe(
      'http://127.0.0.1:41002',
    );
    const replacement = publishAgentServerEndpoint(
      firstRoot,
      'http://127.0.0.1:41003',
    );
    first.release();
    expect(readAgentServerEndpoint(firstRoot)?.url).toBe(
      'http://127.0.0.1:41003',
    );
    replacement.release();
    expect(readAgentServerEndpoint(firstRoot)).toBeNull();
    second.release();
    expect(readAgentServerEndpoint(secondRoot)).toBeNull();
  });

  it.each(['http://127.0.0.1:80', 'https://127.0.0.1:443'])(
    'accepts explicit standard port %s',
    (url) => {
      const root = freshRoot();
      publishAgentServerEndpoint(root, url);
      expect(readAgentServerEndpoint(root)?.url).toBe(url);
    },
  );

  it('writes owner-readable metadata without a client token', () => {
    const root = freshRoot();
    publishAgentServerEndpoint(root, 'https://127.0.0.1:41001');
    const path = join(root, 'agent-server-endpoint.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(
      Object.keys(JSON.parse(readFileSync(path, 'utf8')) as object).sort(),
    ).toEqual(['instanceId', 'url', 'version']);
  });

  it.each([
    'https://example.com:41001',
    'http://127.0.0.1:0',
    'http://user:pass@127.0.0.1:41001',
    'http://127.0.0.1:41001/path',
  ])('rejects invalid discovery address %s', (url) => {
    expect(() => publishAgentServerEndpoint(freshRoot(), url)).toThrow();
  });
});
