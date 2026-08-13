import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const packageDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageDir, '../..');
const distPath = join(packageDir, 'dist', 'index.js');
const internalPackageReleaseAgeExclude = '@themoltnet/*';

function fail(message, output = '') {
  process.stderr.write(`FAIL: ${message}\n${output ? `\n${output}\n` : ''}`);
  process.exit(1);
}

if (!existsSync(distPath)) {
  fail('pi-runtime dist/index.js is missing; run the build before smoke:pack');
}

const bundle = readFileSync(distPath, 'utf8');
const publishedRuntimeDependencies = [
  '@themoltnet/agent-runtime',
  '@themoltnet/sdk',
  '@themoltnet/shell-command-analyzer',
];
for (const dependency of publishedRuntimeDependencies) {
  // Accept both the isomorphic entry ("@themoltnet/sdk") and the Node
  // entry ("@themoltnet/sdk/node") — the Node entry is required for OS
  // keyring secret resolution.
  const importMatched =
    bundle.includes(`from "${dependency}"`) ||
    bundle.includes(`from "${dependency}/node"`);
  if (!importMatched) {
    fail(`pi-runtime must import the published ${dependency} package`);
  }
}
if (/web-tree-sitter\.wasm|tree-sitter-bash\.wasm/.test(bundle)) {
  fail(
    'pi-runtime bundled the shell analyzer and detached its WASM asset paths',
  );
}

const tempRoot = mkdtempSync(join(tmpdir(), 'pi-runtime-pack-smoke-'));
const packDir = join(tempRoot, 'packs');
const installDir = join(tempRoot, 'consumer');
const npmCache = join(tempRoot, 'npm-cache');

function cleanup() {
  rmSync(tempRoot, { recursive: true, force: true });
}

function pack(relativePackageDir) {
  const sourceDir = resolve(repoRoot, relativePackageDir);
  const result = spawnSync(
    'pnpm',
    ['pack', '--pack-destination', packDir, '--json'],
    { cwd: sourceDir, encoding: 'utf8', env: process.env },
  );
  if (result.status !== 0) {
    cleanup();
    fail(
      `pnpm pack failed for ${relativePackageDir}`,
      `${result.stdout}${result.stderr}`,
    );
  }

  let filename;
  try {
    filename = JSON.parse(result.stdout.trim()).filename;
  } catch {
    cleanup();
    fail(`could not parse pnpm pack output for ${relativePackageDir}`);
  }

  const tarball = existsSync(filename) ? filename : join(packDir, filename);
  if (!existsSync(tarball)) {
    cleanup();
    fail(`could not locate packed tarball ${basename(filename)}`);
  }
  return tarball;
}

try {
  mkdirSync(packDir);
  mkdirSync(installDir);
  writeFileSync(
    join(installDir, 'package.json'),
    JSON.stringify({ name: 'pack-smoke', version: '1.0.0', private: true }),
  );

  const tarballs = [
    pack('libs/sdk'),
    pack('libs/agent-runtime'),
    pack('libs/shell-command-analyzer'),
    pack('libs/pi-runtime'),
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
    cleanup();
    fail(
      'npm install of the packed pi-runtime dependency set failed',
      `${install.stdout}${install.stderr}`,
    );
  }

  const run = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "await import('@themoltnet/pi-runtime');",
        "const { ShellCommandAnalyzer } = await import('@themoltnet/shell-command-analyzer');",
        'const analyzer = await ShellCommandAnalyzer.create();',
        "const analysis = analyzer.analyze('echo ready');",
        "if (!analysis.ok || !analysis.tools.some(({ name }) => name === 'echo')) throw new Error('analyzer did not parse echo');",
      ].join('\n'),
    ],
    { cwd: installDir, encoding: 'utf8', env: process.env },
  );
  if (run.status !== 0) {
    cleanup();
    fail(
      'packed pi-runtime could not initialize ShellCommandAnalyzer',
      `${run.stdout}${run.stderr}`,
    );
  }
} finally {
  cleanup();
}

process.stdout.write(
  'OK: packed pi-runtime installs cleanly and initializes ShellCommandAnalyzer\n',
);
