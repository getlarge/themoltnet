import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

it('copies release quarantine and exact exceptions into isolated consumers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-policy-'));
  try {
    const consumer = join(dir, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      "packages:\n  - libs/*\nminimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - '@earendil-works/pi-ai@1.0.0'\n  - '@themoltnet/*'\nallowBuilds:\n  esbuild: true\n",
    );
    const helper = new URL('../../../pack.shared.mjs', import.meta.url).href;
    execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { writePackedConsumerPolicy } from ${JSON.stringify(helper)}; writePackedConsumerPolicy(process.argv[1], process.argv[2]);`,
      dir,
      consumer,
    ]);
    expect(readFileSync(join(consumer, 'pnpm-workspace.yaml'), 'utf8')).toBe(
      "minimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - '@earendil-works/pi-ai@1.0.0'\n  - '@themoltnet/*'\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('overrides every packed dependency before installing an unpublished release', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-release-policy-'));
  try {
    const repo = join(dir, 'repo');
    const bin = join(dir, 'bin');
    const capture = join(dir, 'consumer-policy.yaml');
    const packageDir = join(repo, 'libs/pi-runtime');
    const script = join(packageDir, 'scripts/smoke-packed-analyzer.mjs');
    const dependencies = [
      'sdk',
      'agent-runtime',
      'sandbox-gondolin',
      'shell-command-analyzer',
    ];
    mkdirSync(bin);
    for (const name of [...dependencies, 'pi-runtime']) {
      const root = join(repo, 'libs', name);
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: `@themoltnet/${name}`, version: '9999.0.0' }),
      );
    }
    mkdirSync(join(packageDir, 'scripts'));
    mkdirSync(join(packageDir, 'dist'));
    copyFileSync(
      new URL('../scripts/smoke-packed-analyzer.mjs', import.meta.url),
      script,
    );
    copyFileSync(
      new URL('../../../pack.shared.mjs', import.meta.url),
      join(repo, 'pack.shared.mjs'),
    );
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "minimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - '@themoltnet/*'\n",
    );
    writeFileSync(
      join(packageDir, 'dist/index.js'),
      dependencies
        .map((name) => `export * from "@themoltnet/${name}";`)
        .join('\n'),
    );
    // Stop at the install boundary: inspect the real script's generated
    // policy without a registry, built artifacts, or a runtime probe.
    writeFileSync(
      join(bin, 'pnpm'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'pack') {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const filename = path.join(args[args.indexOf('--pack-destination') + 1], pkg.name.split('/')[1] + '-' + pkg.version + '.tgz');
  fs.writeFileSync(filename, 'fixture archive');
  process.stdout.write(JSON.stringify({ filename }));
} else if (args[0] === 'add') {
  fs.copyFileSync('pnpm-workspace.yaml', process.env.PACK_POLICY_CAPTURE);
  process.stderr.write('fixture install checkpoint');
  process.exitCode = 90;
} else {
  throw new Error('Unexpected pnpm command: ' + args.join(' '));
}
`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        PACK_POLICY_CAPTURE: capture,
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fixture install checkpoint');
    const policy = readFileSync(capture, 'utf8');
    for (const name of dependencies) {
      expect(policy).toMatch(
        new RegExp(
          `"@themoltnet/${name}": "file:.*/${name}-9999\\.0\\.0\\.tgz"`,
        ),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
