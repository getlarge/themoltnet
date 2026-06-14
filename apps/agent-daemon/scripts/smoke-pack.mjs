/**
 * Pack-and-run smoke test for @themoltnet/agent-daemon.
 *
 * Reproduces the real consumer path that broke in issue #1384: a published
 * 0.16.0 installed via `npx` crashed at startup with
 *   ERR_MODULE_NOT_FOUND: Cannot find package '@opentelemetry/instrumentation-pg'
 * because that Vite-SSR-externalized dep (bundled in transitively from
 * @moltnet/observability) was missing from the published `dependencies`.
 *
 * Static checks can't model Vite's externalize-the-transitive-dep behaviour
 * (see the discussion on #1384). The only ground truth is: pack the package
 * exactly as it publishes, install the tarball into a clean directory so every
 * dependency resolves from the registry, and run the bin. If any runtime
 * import is missing from `dependencies`, Node throws at module load and this
 * smoke fails — catching the entire ERR_MODULE_NOT_FOUND class with zero
 * false positives.
 *
 * Chained into `check:pack`, so it runs in the existing release job
 * (release.yml `publish-agent-daemon`), which already `needs` the daemon's
 * @themoltnet/* deps to be published first — so they resolve from npm here.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const pkgDir = join(import.meta.dirname, '..');
const distMain = join(pkgDir, 'dist', 'main.js');

function fail(message, extra = '') {
  process.stderr.write(`FAIL: ${message}\n${extra ? `\n${extra}\n` : ''}`);
  process.exit(1);
}

if (!existsSync(distMain)) {
  fail('agent-daemon dist/main.js is missing; run the build before smoke:pack');
}

// 1. Pack exactly as publish would (pnpm resolves catalog: + workspace:* to
//    concrete versions). --json prints the tarball filename.
const packDest = mkdtempSync(join(tmpdir(), 'daemon-pack-'));
const pack = spawnSync(
  'pnpm',
  ['pack', '--pack-destination', packDest, '--json'],
  { cwd: pkgDir, encoding: 'utf8', env: process.env },
);
if (pack.status !== 0) {
  rmSync(packDest, { recursive: true, force: true });
  fail('pnpm pack failed', `${pack.stdout}${pack.stderr}`);
}
// pnpm pack --json emits a JSON object with a `filename` field; fall back to
// the last non-empty stdout line if the shape ever changes.
let tarball;
try {
  tarball = JSON.parse(pack.stdout.trim()).filename;
} catch {
  tarball = pack.stdout.trim().split('\n').filter(Boolean).pop();
}
if (!tarball || !existsSync(tarball)) {
  // pnpm may print just the basename relative to packDest
  tarball = tarball ? join(packDest, tarball) : undefined;
}
if (!tarball || !existsSync(tarball)) {
  rmSync(packDest, { recursive: true, force: true });
  fail('could not locate packed tarball', pack.stdout);
}

// 2. Install the tarball into a throwaway dir so all deps resolve from the
//    registry — the genuine `npx`/`npm i -g` consumer experience.
const installDir = mkdtempSync(join(tmpdir(), 'daemon-smoke-'));
writeFileSync(
  join(installDir, 'package.json'),
  JSON.stringify({ name: 'daemon-smoke', version: '1.0.0', private: true }),
);

function cleanup() {
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

// 3. Run the bin's --help. This loads the full module graph, evaluating every
//    top-level import — exactly where #1384 crashed. Exit 0 + the banner means
//    every runtime dependency resolved.
const bin = join(installDir, 'node_modules', '.bin', 'moltnet-agent');
const run = spawnSync('node', [bin, '--help'], {
  cwd: installDir,
  encoding: 'utf8',
  env: process.env,
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

if (run.status !== 0) {
  cleanup();
  fail(`packed daemon exited ${run.status} on --help`, output);
}
if (/ERR_MODULE_NOT_FOUND|Cannot find package/.test(output)) {
  cleanup();
  fail('packed daemon is missing a runtime dependency', output);
}
if (!output.includes('long-running task worker for MoltNet')) {
  cleanup();
  fail('packed daemon --help did not print the expected banner', output);
}

cleanup();
process.stdout.write(
  'OK: packed @themoltnet/agent-daemon installs from a tarball and runs --help\n',
);
