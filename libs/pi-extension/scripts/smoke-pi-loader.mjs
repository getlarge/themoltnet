import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const required = process.env.MOLTNET_PI_LOADER_SMOKE === 'required';
const distPath = join(import.meta.dirname, '..', 'dist', 'index.js');
const piBin = process.env.MOLTNET_PI_BIN || 'pi';

if (!existsSync(distPath)) {
  process.stderr.write(
    'FAIL: pi-extension dist/index.js is missing; run the build before smoke:pi-loader\n',
  );
  process.exit(1);
}

const piVersion = spawnSync(piBin, ['--version'], {
  encoding: 'utf8',
  env: process.env,
});

if (piVersion.error?.code === 'ENOENT') {
  const message =
    'SKIP: pi binary not found; set MOLTNET_PI_LOADER_SMOKE=required to make this fatal\n';
  if (required) {
    process.stderr.write(message.replace('SKIP:', 'FAIL:'));
    process.exit(1);
  }
  process.stdout.write(message);
  process.exit(0);
}

if (piVersion.status !== 0) {
  process.stderr.write(
    `FAIL: pi --version failed\n${piVersion.stderr}${piVersion.stdout}`,
  );
  process.exit(1);
}

const version = `${piVersion.stdout}${piVersion.stderr}`.trim() || 'unknown';

const result = spawnSync(
  piBin,
  [
    '--no-extensions',
    '-e',
    distPath,
    '--no-session',
    '--no-tools',
    '-p',
    'noop',
  ],
  {
    encoding: 'utf8',
    env: { ...process.env, PI_OFFLINE: '1' },
  },
);

if (result.error) {
  process.stderr.write(
    `FAIL: pi loader smoke failed: ${result.error.message}\n`,
  );
  process.exit(1);
}

const output = `${result.stdout}${result.stderr}`;
const expected = 'Missing --agent flag';

if (output.includes('Failed to load extension') || !output.includes(expected)) {
  process.stderr.write(
    `FAIL: pi loader smoke did not reach pi-extension validation\n\n${output}`,
  );
  process.exit(1);
}

process.stdout.write(
  `OK: pi ${version} loaded pi-extension and reached --agent validation\n`,
);
