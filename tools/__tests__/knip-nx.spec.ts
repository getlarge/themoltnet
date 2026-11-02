import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { expect, it } from 'vitest';

// End-to-end discovery test against the installed, patched Knip release. It
// guards the patch on upgrades without depending on private plugin interfaces.
it('discovers Nx package targets, configurations, cwd and targetDefaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'knip-nx-'));
  const write = (file: string, content: string | object) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(
      join(root, file),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  };
  try {
    write('package.json', {
      name: 'fixture',
      private: true,
      workspaces: ['apps/*'],
    });
    write('knip.json', { nx: true });
    write('nx.json', {
      targetDefaults: { inspect: { command: 'node tools/default.mjs' } },
    });
    write('apps/demo/package.json', {
      name: 'demo',
      nx: {
        targets: {
          run: {
            executor: 'nx:run-commands',
            options: { command: 'node tools/root.mjs' },
            configurations: {
              alternate: { command: 'node tools/alternate.mjs' },
            },
          },
          relative: {
            executor: 'nx:run-commands',
            options: { cwd: '{projectRoot}', command: 'node local.mjs' },
          },
          explicit: { command: 'node {projectRoot}/explicit.mjs' },
        },
      },
    });
    for (const file of [
      'tools/default.mjs',
      'tools/root.mjs',
      'tools/alternate.mjs',
      'apps/demo/local.mjs',
      'apps/demo/explicit.mjs',
      'tools/dead.mjs',
    ])
      write(file, 'console.log("fixture");');
    const cli = resolve(
      import.meta.dirname,
      '../../node_modules/knip/bin/knip.js',
    );
    const result = spawnSync(process.execPath, [cli, '--reporter', 'json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(
      report.issues
        .filter((row: { files?: unknown[] }) => row.files?.length)
        .map((row: { file: string }) => row.file),
    ).toEqual(['tools/dead.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 40_000);
