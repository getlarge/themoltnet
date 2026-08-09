import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tempDir = mkdtempSync(join(tmpdir(), 'os-keyring-pack-'));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  });
  if (result.error || result.status !== 0) {
    const details = [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n');
    throw new Error(`${command} failed:\n${details}`);
  }
  return result.stdout.trim();
}

try {
  const output = JSON.parse(
    run(
      pnpmCommand,
      ['pack', '--pack-destination', tempDir, '--json'],
      packageDir,
    ),
  );
  const adapterTarball = existsSync(output.filename)
    ? output.filename
    : join(tempDir, output.filename);
  if (!existsSync(adapterTarball)) {
    throw new Error(`missing tarball: ${adapterTarball}`);
  }

  writeFileSync(
    join(tempDir, 'package.json'),
    JSON.stringify({ name: 'keyring-smoke', private: true }),
  );
  run(
    npmCommand,
    ['install', '--no-audit', '--no-fund', adapterTarball],
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
