#!/usr/bin/env tsx
/**
 * Pack-and-install smoke for the agent-daemon -> agent-daemon-state boundary.
 *
 * The daemon-state package owns file-based Drizzle migrations. If Vite inlines
 * it into the daemon CLI bundle, migration discovery resolves relative to
 * @themoltnet/agent-daemon/dist instead of @themoltnet/agent-daemon-state and
 * `DaemonSlotRegistry` fails while opening SQLite in published/npx installs.
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

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const daemonDir = join(root, 'apps/agent-daemon');
const stateDir = join(root, 'libs/agent-daemon-state');

function fail(message: string, extra = ''): never {
  process.stderr.write(`FAIL: ${message}\n${extra ? `\n${extra}\n` : ''}`);
  process.exit(1);
}

function packPackage(pkgDir: string, packDest: string): string {
  const pack = spawnSync(
    'pnpm',
    ['pack', '--pack-destination', packDest, '--json'],
    { cwd: pkgDir, encoding: 'utf8', env: process.env },
  );
  if (pack.status !== 0) {
    fail(`pnpm pack failed for ${pkgDir}`, `${pack.stdout}${pack.stderr}`);
  }

  let tarball: string | undefined;
  try {
    tarball = JSON.parse(pack.stdout.trim()).filename as string;
  } catch {
    tarball = pack.stdout.trim().split('\n').filter(Boolean).pop();
  }
  if (tarball && !existsSync(tarball)) {
    tarball = join(packDest, tarball);
  }
  if (!tarball || !existsSync(tarball)) {
    fail(`could not locate packed tarball for ${pkgDir}`, pack.stdout);
  }
  return tarball;
}

const packDest = mkdtempSync(join(tmpdir(), 'agent-daemon-state-pack-'));
const installDir = mkdtempSync(join(tmpdir(), 'agent-daemon-state-run-'));

function cleanup(): void {
  rmSync(packDest, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
}

try {
  const stateTarball = packPackage(stateDir, packDest);
  const daemonTarball = packPackage(daemonDir, packDest);

  writeFileSync(
    join(installDir, 'package.json'),
    JSON.stringify({ name: 'smoke', version: '1.0.0', private: true }),
  );

  const install = spawnSync(
    'npm',
    [
      'install',
      daemonTarball,
      stateTarball,
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
    ],
    { cwd: installDir, encoding: 'utf8', env: process.env },
  );
  if (install.status !== 0) {
    fail(
      'npm install of packed daemon/state tarballs failed',
      `${install.stdout}${install.stderr}`,
    );
  }

  const daemonBundle = readFileSync(
    join(installDir, 'node_modules/@themoltnet/agent-daemon/dist/main.js'),
    'utf8',
  );
  if (daemonBundle.includes('findMigrationsFolder("drizzle-sqlite")')) {
    fail('@themoltnet/agent-daemon bundle inlined daemon-state migrations');
  }

  const dbPath = resolve(installDir, 'daemon-state.sqlite');
  const smoke = spawnSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `
        import { DaemonSlotRegistry } from '@themoltnet/agent-daemon-state';
        const registry = new DaemonSlotRegistry(${JSON.stringify(dbPath)});
        await registry.close();
      `,
    ],
    { cwd: installDir, encoding: 'utf8', env: process.env },
  );
  if (smoke.status !== 0) {
    fail(
      'installed daemon-state package could not open SQLite registry',
      `${smoke.stdout}${smoke.stderr}`,
    );
  }
} finally {
  cleanup();
}

process.stdout.write(
  'OK: packed agent-daemon keeps daemon-state external and installed daemon-state opens SQLite registry\n',
);
