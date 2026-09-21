import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { desktopDevelopmentEnvironment } from './desktop-development.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('Desktop development environment', () => {
  it('uses predictable separate stores and installations for worktrees', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-dev-')));
    roots.push(home);
    const first = desktopDevelopmentEnvironment({}, join(home, 'first'), home);
    expect(first.MOLTNET_HOME).toContain(`${sep}development${sep}`);
    expect(first.MOLTNET_AGENT_HOME).toContain(`${sep}development${sep}`);
    expect(first.MOLTNET_HOME).not.toBe(first.MOLTNET_AGENT_HOME);
    expect(
      desktopDevelopmentEnvironment({}, join(home, 'first'), home),
    ).toEqual(first);
    expect(
      desktopDevelopmentEnvironment({}, join(home, 'second'), home)
        .MOLTNET_HOME,
    ).not.toBe(first.MOLTNET_HOME);
    const explicit = desktopDevelopmentEnvironment(
      { MOLTNET_DEV_HOME: './custom', MOLTNET_DEV_AGENT_HOME: './install' },
      home,
      home,
    );
    expect(explicit.MOLTNET_HOME).toBe(join(home, 'custom'));
    expect(explicit.MOLTNET_AGENT_HOME).toBe(join(home, 'install'));
    expect(() =>
      desktopDevelopmentEnvironment({ MOLTNET_DEV_HOME: '' }, home, home),
    ).toThrow();
    const inherited = desktopDevelopmentEnvironment(
      {
        MOLTNET_HOME: join(home, '.config/moltnet'),
        MOLTNET_AGENT_SERVER_ROOT: './production',
        MOLTNET_AGENT_SERVER_PORT: '17374',
        MOLTNET_CREDENTIALS_PATH: '/production/credentials',
        MOLTNET_ACTIVE_IDENTITY: 'production',
        MOLTNET_DEFAULT_STORE_ROOT: '/production',
        MOLTNET_AGENT_HOME: join(home, '.local/share/moltnet/agent'),
        MOLTNET_AGENT_BIN_DIR: join(home, '.local/bin'),
      },
      join(home, 'first'),
      home,
    );
    expect(inherited.MOLTNET_HOME).toBe(first.MOLTNET_HOME);
    expect(inherited.MOLTNET_AGENT_HOME).toBe(first.MOLTNET_AGENT_HOME);
    expect(inherited.MOLTNET_AGENT_BIN_DIR).toBe(
      join(first.MOLTNET_AGENT_HOME!, 'bin'),
    );
    for (const name of [
      'MOLTNET_AGENT_SERVER_ROOT',
      'MOLTNET_AGENT_SERVER_PORT',
      'MOLTNET_CREDENTIALS_PATH',
      'MOLTNET_ACTIVE_IDENTITY',
      'MOLTNET_DEFAULT_STORE_ROOT',
    ])
      expect(inherited[name]).toBeUndefined();
  });
});
