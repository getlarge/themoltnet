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

import { writePackedConsumerPolicy } from '../../../pack.shared.mjs';

const packageDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageDir, '../..');
const distPath = join(packageDir, 'dist', 'index.js');

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
  '@themoltnet/sandbox-gondolin',
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
  const sandboxGondolinTarball = pack('libs/sandbox-gondolin');
  const sdkTarball = pack('libs/sdk');
  const agentRuntimeTarball = pack('libs/agent-runtime');
  const tarballs = [
    sdkTarball,
    agentRuntimeTarball,
    sandboxGondolinTarball,
    pack('libs/shell-command-analyzer'),
    pack('libs/pi-runtime'),
  ];
  writeFileSync(
    join(installDir, 'package.json'),
    JSON.stringify({
      name: 'pack-smoke',
      version: '1.0.0',
      private: true,
      // pi-runtime's published manifest pins its @themoltnet/* dependencies by
      // version. When a change extends one of their APIs before the version is
      // bumped, pnpm would otherwise dedupe to the same-version npm copy that
      // lacks the new export. Force every locally packed dependency so the
      // smoke proves the packed closure even before those versions reach npm.
      pnpm: {
        overrides: {
          '@themoltnet/agent-runtime': `file:${agentRuntimeTarball}`,
          '@themoltnet/sandbox-gondolin': `file:${sandboxGondolinTarball}`,
          '@themoltnet/sdk': `file:${sdkTarball}`,
        },
      },
    }),
  );

  writePackedConsumerPolicy(repoRoot, installDir);
  const install = spawnSync('pnpm', ['add', ...tarballs, '--ignore-scripts'], {
    cwd: installDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: npmCache,
    },
  });
  if (install.status !== 0) {
    cleanup();
    fail(
      'npm install of the packed pi-runtime dependency set failed',
      `${install.stdout}${install.stderr}`,
    );
  }

  const probePath = join(installDir, 'probe.mjs');
  writeFileSync(
    probePath,
    [
      "const runtime = await import('@themoltnet/pi-runtime');",
      "if ('writePiConfig' in runtime || 'writeAgentCredentials' in runtime) throw new Error('root runtime leaked config writers');",
      'let codemode;',
      'const factory = await runtime.piCodemode().create({});',
      'factory({ registerTool(tool) { codemode = tool; } });',
      "const script = await codemode.execute('pack-smoke', { code: 'text(6 * 7)' });",
      "if (!script.content.some(item => item.type === 'text' && item.text.includes('42'))) throw new Error('native codemode WASM failed: ' + JSON.stringify(script));",
      "if (typeof runtime.createPiTaskExecutor !== 'function') throw new Error('Pi task executor missing');",
      "if (typeof runtime.createClassificationTaskExecutor !== 'function') throw new Error('Classification task executor missing');",
      "const piConfig = await import('@themoltnet/pi-runtime/pi-config');",
      "if (typeof piConfig.writePiConfig !== 'function' || 'writeAgentCredentials' in piConfig) throw new Error('focused pi-config exports are incorrect');",
      "const { ShellCommandAnalyzer } = await import('@themoltnet/shell-command-analyzer');",
      'const analyzer = await ShellCommandAnalyzer.create();',
      "const analysis = analyzer.analyze('echo ready');",
      "if (!analysis.ok || !analysis.tools.some(({ name }) => name === 'echo')) throw new Error('analyzer did not parse echo');",
    ].join('\n'),
  );
  const run = spawnSync(process.execPath, [probePath], {
    cwd: installDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (run.status !== 0) {
    cleanup();
    fail(
      'packed pi-runtime capability probe failed',
      `${run.stdout}${run.stderr}`,
    );
  }
} finally {
  cleanup();
}

process.stdout.write(
  'OK: packed pi-runtime loads native codemode WASM, task executors, focused Pi config, and ShellCommandAnalyzer\n',
);
