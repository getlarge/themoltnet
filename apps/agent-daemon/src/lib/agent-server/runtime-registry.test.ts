import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RuntimeRegistry } from './runtime-registry.js';

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'runtime-registry-'));
  roots.push(root);
  const module = join(root, 'runtime.mjs');
  writeFileSync(
    module,
    'export default { runtimeKind: "review_pi", async prepare() { return {}; } };',
  );
  return { root, module, registry: new RuntimeRegistry(join(root, 'store')) };
}

describe('RuntimeRegistry', () => {
  it('registers a validated local module and detects entry drift', async () => {
    const { module, registry } = fixture();
    await registry.register('review_pi', `file://${module}`);
    expect(registry.resolve('review_pi')?.moduleUrl).toContain('runtime.mjs');
    writeFileSync(
      module,
      'export default { runtimeKind: "review_pi", async prepare() { return { changed: true }; } };',
    );
    expect(() => registry.resolve('review_pi')).toThrow('has changed');
  });

  it('rejects a runtime whose declared kind differs from its registration', async () => {
    const { module, registry } = fixture();
    await expect(
      registry.register('other_pi', `file://${module}`),
    ).rejects.toThrow('provides "review_pi"');
  });

  it('requires and fingerprints a package lockfile', async () => {
    const { root, registry } = fixture();
    const packageDir = join(root, 'node_modules', '@example', 'runtime');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@example/runtime',
        type: 'module',
        exports: './index.mjs',
      }),
    );
    writeFileSync(
      join(packageDir, 'index.mjs'),
      'export default { runtimeKind: "review_pi", async prepare() { return {}; } };',
    );
    await expect(
      registry.register('review_pi', '@example/runtime', root),
    ).rejects.toThrow('requires a pnpm');
  });

  it('refuses malformed persistent state', () => {
    const { root, registry } = fixture();
    mkdirSync(join(root, 'store'));
    writeFileSync(
      join(root, 'store', 'runtime-registry.json'),
      JSON.stringify([{ kind: 'bad' }]),
    );
    expect(() => registry.list()).toThrow('invalid registration');
  });
});
