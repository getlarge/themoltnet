import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const exactPackage = `${manifest.name}@${manifest.version}`;
const temporary = mkdtempSync(join(tmpdir(), 'moltnet-n8n-publish-'));

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 600_000,
    ...options,
  });
}

function localIntegrity() {
  const result = run('npm', [
    'pack',
    '--json',
    '--pack-destination',
    temporary,
  ]);
  if (result.status !== 0) {
    throw new Error(`npm pack failed: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  const pack = Array.isArray(parsed)
    ? parsed[0]
    : parsed.filename
      ? parsed
      : Object.values(parsed)[0];
  if (!pack || typeof pack.filename !== 'string') {
    throw new Error('npm pack did not return a package filename');
  }
  const tarball = isAbsolute(pack.filename)
    ? pack.filename
    : resolve(temporary, pack.filename);
  return `sha512-${createHash('sha512')
    .update(readFileSync(tarball))
    .digest('base64')}`;
}

function registryIntegrity(expected) {
  const result = run('npm', ['view', exactPackage, 'dist.integrity', '--json']);
  if (result.status === 0) {
    const published = JSON.parse(result.stdout);
    if (published !== expected) {
      throw new Error(
        `Published integrity mismatch for ${exactPackage}: expected ${expected}, received ${String(published)}`,
      );
    }
    return 'published';
  }
  if (/\bE404\b|404 Not Found/iu.test(`${result.stdout}\n${result.stderr}`)) {
    return 'missing';
  }
  throw new Error(
    `Unable to inspect ${exactPackage}: ${`${result.stdout}\n${result.stderr}`.trim()}`,
  );
}

try {
  const expected = localIntegrity();
  if (registryIntegrity(expected) === 'published') {
    process.stdout.write(
      `${exactPackage} is already published with matching integrity\n`,
    );
    process.exit(0);
  }
  const published = run(
    'npm',
    ['publish', '--access', 'public', '--provenance'],
    { stdio: 'inherit' },
  );
  if (published.status !== 0 && registryIntegrity(expected) !== 'published') {
    throw new Error(
      `npm publish failed with status ${String(published.status)}`,
    );
  }
  process.stdout.write(`${exactPackage} published with verified integrity\n`);
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
