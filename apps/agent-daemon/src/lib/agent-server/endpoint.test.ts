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
  it('validates standalone loopback discovery origins', () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL(
          '../../../../../test-fixtures/agent-server-endpoint.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { url: string; valid: boolean }[];
    for (const fixture of fixtures) {
      const root = freshRoot();
      const publish = () => publishAgentServerEndpoint(root, fixture.url);
      if (fixture.valid) expect(publish).not.toThrow();
      else expect(publish).toThrow();
    }
  });
  it('assigns an isolated port even when the default config directory is broken', () => {
    const home = freshRoot();
    vi.stubEnv('HOME', home);
    writeFileSync(join(home, '.config'), 'fixture');
    expect(defaultAgentServerPort(freshRoot())).toBe(0);
  });
  it('preserves the default port and assigns isolated roots an ephemeral port', () => {
    vi.stubEnv('HOME', freshRoot());
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

  it('ignores discovery left by an exited process', () => {
    const root = freshRoot();
    writeFileSync(
      join(root, 'agent-server-endpoint.json'),
      JSON.stringify({
        version: 1,
        instanceId: '12345678-1234-4123-8123-123456789abc',
        pid: 2147483647,
        url: 'http://127.0.0.1:41001',
      }),
    );
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('exited'), { code: 'ESRCH' });
    });
    try {
      expect(readAgentServerEndpoint(root)).toBeNull();
    } finally {
      kill.mockRestore();
    }
  });

  it('reports malformed metadata with its path and preserves the shutdown result', () => {
    const root = freshRoot();
    const published = publishAgentServerEndpoint(
      root,
      'http://127.0.0.1:41001',
    );
    const path = join(root, 'agent-server-endpoint.json');
    writeFileSync(path, '{');
    expect(() => readAgentServerEndpoint(root)).toThrow(path);
    expect(() => published.release()).not.toThrow();
  });

  it.each(['http://127.0.0.1:80'])(
    'accepts explicit standard port %s',
    (url) => {
      const root = freshRoot();
      publishAgentServerEndpoint(root, url);
      expect(readAgentServerEndpoint(root)?.url).toBe(url);
    },
  );

  it.each(['', 'fixture', '12345678-1234-4123-8123-123456789abc\nforged'])(
    'rejects invalid instance ID %j',
    (instanceId) => {
      const root = freshRoot();
      writeFileSync(
        join(root, 'agent-server-endpoint.json'),
        JSON.stringify({
          version: 1,
          instanceId,
          url: 'http://127.0.0.1:41001',
        }),
      );
      expect(() => readAgentServerEndpoint(root)).toThrow('metadata');
    },
  );

  it('writes owner-readable metadata without a client token', () => {
    const root = freshRoot();
    publishAgentServerEndpoint(root, 'http://127.0.0.1:41001');
    const path = join(root, 'agent-server-endpoint.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(
      Object.keys(JSON.parse(readFileSync(path, 'utf8')) as object).sort(),
    ).toEqual(['instanceId', 'pid', 'url', 'version']);
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
