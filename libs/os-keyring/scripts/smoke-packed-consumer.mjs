import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const libsDir = dirname(packageDir);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const platformDir = {
  darwin: 'os-keyring-darwin',
  linux: 'os-keyring-linux',
  win32: 'os-keyring-win32',
}[process.platform];

if (!platformDir) {
  throw new Error(`unsupported keyring platform: ${process.platform}`);
}

const tempDir = mkdtempSync(join(tmpdir(), 'os-keyring-pack-'));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

function pack(dir) {
  const output = JSON.parse(
    run(pnpmCommand, ['pack', '--pack-destination', tempDir, '--json'], dir),
  );
  const tarball = existsSync(output.filename)
    ? output.filename
    : join(tempDir, output.filename);
  if (!existsSync(tarball)) throw new Error(`missing tarball: ${tarball}`);
  return tarball;
}

try {
  const platformTarball = pack(join(libsDir, platformDir));
  const adapterTarball = pack(packageDir);
  writeFileSync(
    join(tempDir, 'package.json'),
    JSON.stringify({ name: 'keyring-smoke', private: true }),
  );
  run(
    npmCommand,
    ['install', '--no-audit', '--no-fund', platformTarball, adapterTarball],
    tempDir,
  );
  run(
    'node',
    [
      '--input-type=module',
      '--eval',
      "const { OSKeyringSecretProvider } = await import('@themoltnet/os-keyring'); await new OSKeyringSecretProvider().read('smoke/missing-key');",
    ],
    tempDir,
  );
  process.stdout.write(
    `Packed keyring consumer passed on ${process.platform}\n`,
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
