#!/usr/bin/env tsx
/**
 * Pack-and-run smoke test for executable published packages.
 *
 * Reproduces the real consumer path that broke in issue #1384: a published
 * @themoltnet/agent-daemon 0.16.0 installed via `npx` crashed at startup with
 *   ERR_MODULE_NOT_FOUND: Cannot find package '@opentelemetry/instrumentation-pg'
 * because that Vite-SSR-externalized dep (bundled in transitively from a
 * private @moltnet/* lib) was missing from the published `dependencies`.
 *
 * Static checks can't model Vite's externalize-the-transitive-dep behaviour
 * (see the discussion on #1384): @nx/dependency-checks reads the declared
 * project graph, not the tree-shaken bundle, so it both false-positives and
 * misses the real bug. The only ground truth is: pack the package exactly as
 * it publishes, install the tarball into a clean directory so every dependency
 * resolves from the registry, and run the bin. If any runtime import is missing
 * from `dependencies`, Node throws at module load and this smoke fails —
 * catching the entire ERR_MODULE_NOT_FOUND class with zero false positives.
 *
 * Chained into each package's `check:pack`, so it runs in the existing release
 * jobs. Those jobs already `needs` the package's @themoltnet/* deps to be
 * published first, so they resolve from npm here.
 *
 * Usage:
 *   tsx tools/src/smoke-pack.ts --package . --bin moltnet-agent \
 *     --args --help --expect "long-running task worker for MoltNet"
 *
 * Flags:
 *   --package  package dir to pack (default ".")
 *   --bin      bin name to invoke from node_modules/.bin (required)
 *   --args     args passed to the bin (default "--help"); everything after
 *              --args until --expect is treated as bin args
 *   --expect   substring that must appear in the bin's output (required)
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

function parseFlags(argv: string[]): {
  pkg: string;
  bin: string;
  args: string[];
  expect: string;
} {
  let pkg = '.';
  let bin = '';
  let expect = '';
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--package') pkg = argv[++i];
    else if (flag === '--bin') bin = argv[++i];
    else if (flag === '--expect') expect = argv[++i];
    else if (flag === '--args') {
      // consume the rest until the next recognised flag
      while (
        i + 1 < argv.length &&
        !['--package', '--bin', '--expect'].includes(argv[i + 1])
      ) {
        args.push(argv[++i]);
      }
    }
  }
  return { pkg, bin, args: args.length ? args : ['--help'], expect };
}

const { pkg, bin, args, expect } = parseFlags(process.argv.slice(2));

if (!bin) {
  process.stderr.write('FAIL: --bin <name> is required\n');
  process.exit(1);
}
if (!expect) {
  process.stderr.write('FAIL: --expect <substring> is required\n');
  process.exit(1);
}

const pkgDir = resolve(pkg);

function fail(message: string, extra = ''): never {
  process.stderr.write(`FAIL: ${message}\n${extra ? `\n${extra}\n` : ''}`);
  process.exit(1);
}

// The bin's target must exist before packing — otherwise the tarball ships an
// empty/stale dist and the failure surfaces later as a confusing "bin not
// found". Resolve the bin target from package.json#bin and check it up front.
const pkgJson = JSON.parse(
  readFileSync(join(pkgDir, 'package.json'), 'utf8'),
) as { bin?: string | Record<string, string> };
const binTarget =
  typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[bin];
if (!binTarget) {
  fail(`package.json#bin has no entry for "${bin}"`);
}
if (!existsSync(join(pkgDir, binTarget))) {
  fail(`bin target ${binTarget} is missing; run the build before smoke:pack`);
}

// 1. Pack exactly as publish would (pnpm resolves catalog: + workspace:* to
//    concrete versions). --json prints the tarball filename.
const packDest = mkdtempSync(join(tmpdir(), 'smoke-pack-'));
const pack = spawnSync(
  'pnpm',
  ['pack', '--pack-destination', packDest, '--json'],
  { cwd: pkgDir, encoding: 'utf8', env: process.env },
);
if (pack.status !== 0) {
  rmSync(packDest, { recursive: true, force: true });
  fail('pnpm pack failed', `${pack.stdout}${pack.stderr}`);
}
let tarball: string | undefined;
try {
  tarball = JSON.parse(pack.stdout.trim()).filename as string;
} catch {
  tarball = pack.stdout.trim().split('\n').filter(Boolean).pop();
}
if (tarball && !existsSync(tarball)) {
  // pnpm may print just the basename relative to packDest
  tarball = join(packDest, tarball);
}
if (!tarball || !existsSync(tarball)) {
  rmSync(packDest, { recursive: true, force: true });
  fail('could not locate packed tarball', pack.stdout);
}

// 2. Install the tarball into a throwaway dir so all deps resolve from the
//    registry — the genuine `npx`/`npm i -g` consumer experience.
const installDir = mkdtempSync(join(tmpdir(), 'smoke-run-'));
writeFileSync(
  join(installDir, 'package.json'),
  JSON.stringify({ name: 'smoke', version: '1.0.0', private: true }),
);

function cleanup(): void {
  rmSync(packDest, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
}

const install = spawnSync(
  'npm',
  ['install', tarball, '--no-audit', '--no-fund', '--loglevel=error'],
  { cwd: installDir, encoding: 'utf8', env: process.env },
);
if (install.status !== 0) {
  const out = `${install.stdout}${install.stderr}`;
  cleanup();
  fail('npm install of the packed tarball failed', out);
}

// 3. Run the bin. This loads the full module graph, evaluating every top-level
//    import — exactly where #1384 crashed. Exit 0 + expected output means every
//    runtime dependency resolved.
const binPath = join(installDir, 'node_modules', '.bin', bin);
if (!existsSync(binPath)) {
  cleanup();
  fail(`bin "${bin}" not found in the installed tarball`);
}
const run = spawnSync('node', [binPath, ...args], {
  cwd: installDir,
  encoding: 'utf8',
  env: process.env,
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

if (
  /ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/.test(output)
) {
  cleanup();
  fail(`${bin} is missing a runtime dependency`, output);
}
if (run.status !== 0) {
  cleanup();
  fail(`${bin} exited ${run.status} on [${args.join(' ')}]`, output);
}
if (!output.includes(expect)) {
  cleanup();
  fail(`${bin} output did not contain "${expect}"`, output);
}

cleanup();
process.stdout.write(
  `OK: packed ${pkgDir.split('/').pop()} installs from a tarball and runs ${bin} ${args.join(' ')}\n`,
);
