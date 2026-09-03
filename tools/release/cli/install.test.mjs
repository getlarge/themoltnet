import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const installer = join(here, 'install.sh');
const version = '1.2.3';
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function archiveName() {
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  return `moltnet_${version}_${os}_${arch}.tar.gz`;
}

function fixture({
  candidateVersion = version,
  failAfterInstall = false,
} = {}) {
  const root = tempDir('moltnet-cli-installer-');
  const assets = join(root, 'assets');
  const payload = join(root, 'payload');
  const counter = join(root, 'candidate-runs');
  mkdirSync(assets);
  mkdirSync(payload);
  const candidate = join(payload, 'moltnet');
  writeFileSync(
    candidate,
    [
      '#!/bin/sh',
      'if [ "${1:-}" = version ]; then',
      failAfterInstall
        ? `[ -e '${counter}' ] && exit 1; touch '${counter}';`
        : '',
      `  echo 'moltnet ${candidateVersion}'`,
      'fi',
    ].join('\n'),
  );
  chmodSync(candidate, 0o755);
  const archive = join(assets, archiveName());
  const packed = run('tar', ['-czf', archive, '-C', payload, 'moltnet']);
  assert.equal(packed.status, 0, packed.stderr);
  writeFileSync(
    join(assets, 'checksums.txt'),
    `${sha256(archive)}  ${basename(archive)}\n`,
  );
  const key = join(root, 'signing-key');
  assert.equal(
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]).status,
    0,
  );
  assert.equal(
    run('ssh-keygen', [
      '-Y',
      'sign',
      '-f',
      key,
      '-n',
      'moltnet-release',
      join(assets, 'checksums.txt'),
    ]).status,
    0,
  );
  const publicKey = readFileSync(`${key}.pub`, 'utf8')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  const rendered = join(root, 'install.sh');
  writeFileSync(
    rendered,
    readFileSync(installer, 'utf8')
      .replace(
        'RELEASE_PINNED_VERSION=""',
        `RELEASE_PINNED_VERSION="${version}"`,
      )
      .replace(
        'RELEASE_SIGNER_PUBKEY=""',
        `RELEASE_SIGNER_PUBKEY="${publicKey}"`,
      ),
  );
  chmodSync(rendered, 0o755);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'curl'),
    [
      '#!/bin/sh',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in -o) out=$2; shift 2 ;; *) url=$1; shift ;; esac',
      'done',
      `cp "${assets}/$(basename "$url")" "$out"`,
    ].join('\n'),
  );
  chmodSync(join(bin, 'curl'), 0o755);
  return { assets, bin, rendered, root };
}

function target(root) {
  const replacement = join(root, 'moltnet');
  writeFileSync(replacement, '#!/bin/sh\necho "moltnet old"\n');
  chmodSync(replacement, 0o755);
  return replacement;
}

function install({ bin, rendered }, replacement) {
  return run('sh', [rendered, '--replace', replacement], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

describe('verified CLI installer', () => {
  it('verifies and atomically replaces only the selected executable', () => {
    const release = fixture();
    const replacement = target(release.root);
    const result = install(release, replacement);
    assert.equal(result.status, 0, result.stderr);
    assert.match(run(replacement, ['version']).stdout, /moltnet 1\.2\.3/);
  });

  it('refuses a checksum mismatch before touching the selected executable', () => {
    const release = fixture();
    const replacement = target(release.root);
    writeFileSync(join(release.assets, archiveName()), 'tampered');
    const result = install(release, replacement);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
    assert.match(run(replacement, ['version']).stdout, /moltnet old/);
  });

  it('rolls back when the post-replacement version check fails', () => {
    const release = fixture({ failAfterInstall: true });
    const replacement = target(release.root);
    const result = install(release, replacement);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /restored prior binary/);
    assert.match(run(replacement, ['version']).stdout, /moltnet old/);
  });

  it('refuses non-executable and relative replacement targets', () => {
    const release = fixture();
    const relative = install(release, 'moltnet');
    const nonExecutable = join(release.root, 'not-executable');
    writeFileSync(nonExecutable, 'not executable');
    const refused = install(release, nonExecutable);
    assert.notEqual(relative.status, 0);
    assert.match(relative.stderr, /must be absolute/);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /non-executable target/);
  });
});
