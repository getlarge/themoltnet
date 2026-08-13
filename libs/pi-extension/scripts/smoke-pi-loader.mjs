import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const required = process.env.MOLTNET_PI_LOADER_SMOKE === 'required';
const packageDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageDir, '../..');
const localDistPath = join(packageDir, 'dist', 'index.js');
const piBin = process.env.MOLTNET_PI_BIN || 'pi';
const internalPackageReleaseAgeExclude = '@themoltnet/*';

if (!existsSync(localDistPath)) {
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
const tempRoot = mkdtempSync(join(tmpdir(), 'pi-extension-loader-smoke-'));
const packDir = join(tempRoot, 'packs');
const installDir = join(tempRoot, 'consumer');
const npmCache = join(tempRoot, 'npm-cache');

function fail(message, output = '') {
  rmSync(tempRoot, { recursive: true, force: true });
  process.stderr.write(`FAIL: ${message}\n${output ? `\n${output}\n` : ''}`);
  process.exit(1);
}

function pack(relativePackageDir) {
  const result = spawnSync(
    'pnpm',
    ['pack', '--pack-destination', packDir, '--json'],
    {
      cwd: resolve(repoRoot, relativePackageDir),
      encoding: 'utf8',
      env: process.env,
    },
  );
  if (result.status !== 0) {
    fail(
      `pnpm pack failed for ${relativePackageDir}`,
      `${result.stdout}${result.stderr}`,
    );
  }

  let filename;
  try {
    filename = JSON.parse(result.stdout.trim()).filename;
  } catch {
    fail(`could not parse pnpm pack output for ${relativePackageDir}`);
  }

  const tarball = existsSync(filename) ? filename : join(packDir, filename);
  if (!existsSync(tarball)) {
    fail(`could not locate packed tarball ${basename(filename)}`);
  }
  return tarball;
}

mkdirSync(packDir);
mkdirSync(installDir);
writeFileSync(
  join(installDir, 'package.json'),
  JSON.stringify({
    name: 'pi-extension-smoke',
    version: '1.0.0',
    private: true,
  }),
);

const tarballs = [
  pack('libs/sdk'),
  pack('libs/agent-runtime'),
  pack('libs/shell-command-analyzer'),
  pack('libs/pi-runtime'),
  pack('libs/pi-extension'),
];
const install = spawnSync('pnpm', ['add', ...tarballs, '--ignore-scripts'], {
  cwd: installDir,
  encoding: 'utf8',
  env: {
    ...process.env,
    npm_config_cache: npmCache,
    // pnpm exports the scalar minimumReleaseAge setting to lifecycle scripts,
    // but not its array-valued exclusions. Preserve the internal-package
    // exception when this consumer install runs outside the workspace.
    npm_config_minimum_release_age_exclude: internalPackageReleaseAgeExclude,
  },
});
if (install.status !== 0) {
  fail(
    'npm install of the packed pi-extension dependency set failed',
    `${install.stdout}${install.stderr}`,
  );
}

const distPath = join(
  installDir,
  'node_modules',
  '@themoltnet',
  'pi-extension',
  'dist',
  'index.js',
);

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
  fail(`pi loader smoke failed: ${result.error.message}`);
}

const output = `${result.stdout}${result.stderr}`;
const expected = 'Missing --agent flag';

if (output.includes('Failed to load extension') || !output.includes(expected)) {
  fail('pi loader smoke did not reach pi-extension validation', output);
}

rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(
  `OK: pi ${version} loaded packed pi-extension and reached --agent validation\n`,
);
