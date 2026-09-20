import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    expect(first.MOLTNET_HOME).toContain('/development/');
    expect(first.MOLTNET_AGENT_HOME).toContain('/development/');
    expect(first.MOLTNET_HOME).not.toBe(first.MOLTNET_AGENT_HOME);
    expect(
      desktopDevelopmentEnvironment({}, join(home, 'first'), home),
    ).toEqual(first);
    expect(
      desktopDevelopmentEnvironment({}, join(home, 'second'), home)
        .MOLTNET_HOME,
    ).not.toBe(first.MOLTNET_HOME);
    const explicit = desktopDevelopmentEnvironment(
      { MOLTNET_HOME: './custom', MOLTNET_AGENT_HOME: './install' },
      home,
      home,
    );
    expect(explicit.MOLTNET_HOME).toBe(join(home, 'custom'));
    expect(explicit.MOLTNET_AGENT_HOME).toBe(join(home, 'install'));
    expect(() =>
      desktopDevelopmentEnvironment({ MOLTNET_HOME: '' }, home, home),
    ).toThrow();
    expect(() =>
      desktopDevelopmentEnvironment(
        { MOLTNET_HOME: './a', MOLTNET_AGENT_SERVER_ROOT: './b' },
        home,
        home,
      ),
    ).toThrow();
  });
});
