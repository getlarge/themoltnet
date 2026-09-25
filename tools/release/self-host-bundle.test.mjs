import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const script = path.join(repoRoot, 'tools/release/self-host-bundle.mjs');

test('builds an installable source archive with current component versions', () => {
  const temporary = mkdtempSync(
    path.join(os.tmpdir(), 'moltnet-self-host-test-'),
  );
  const output = path.join(temporary, 'bundle');
  try {
    execFileSync(
      'node',
      [script, '--version', 'test', '--skip-digests', '--output', output],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    );

    const versions = JSON.parse(
      readFileSync(
        path.join(repoRoot, '.release-please-manifest.json'),
        'utf8',
      ),
    );
    const releaseEnv = readFileSync(
      path.join(output, 'deploy/self-host/.env.release'),
      'utf8',
    );
    const registry = JSON.parse(
      readFileSync(path.join(repoRoot, 'nx.json'), 'utf8'),
    ).release.docker.registryUrl;
    assert.match(releaseEnv, new RegExp(`REST_API_IMAGE=${registry}/`));
    assert.match(
      releaseEnv,
      new RegExp(`REST_API_IMAGE=.*:${versions['apps/rest-api']}`),
    );
    assert.match(
      releaseEnv,
      new RegExp(`DB_MIGRATE_IMAGE=.*:${versions['libs/database']}`),
    );
    const releaseSignerPublicKey = execFileSync(
      'bash',
      [path.join(repoRoot, 'tools/release/release-signer-pubkey.sh'), repoRoot],
      { encoding: 'utf8' },
    ).trim();
    assert.ok(
      releaseEnv.includes(`RELEASE_SIGNER_PUBKEY=${releaseSignerPublicKey}\n`),
    );

    const composeDir = path.join(output, 'deploy/self-host');
    assert.equal(existsSync(path.join(composeDir, '.env')), false);
    assert.equal(
      existsSync(path.join(composeDir, 'config/provision-native-client.mjs')),
      true,
    );
    assert.equal(
      existsSync(
        path.join(output, 'infra/ory/oauth2-clients/moltnet-native.json'),
      ),
      true,
    );
    const config = spawnSync(
      'docker',
      [
        'compose',
        '--env-file',
        '.env.example',
        '--env-file',
        '.env.release',
        'config',
        '--quiet',
      ],
      {
        cwd: composeDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...Object.fromEntries(
            [
              ...readFileSync(
                path.join(composeDir, 'compose.yaml'),
                'utf8',
              ).matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g),
            ].map(([, name]) => [name, 'test-secret']),
          ),
        },
      },
    );
    assert.equal(config.status, 0, config.stderr);

    const unconfigured = spawnSync(
      'docker',
      ['compose', '--env-file', '.env.example', 'config', '--quiet'],
      { cwd: composeDir, encoding: 'utf8', env: process.env },
    );
    assert.notEqual(
      unconfigured.status,
      0,
      'empty secrets must reject an unconfigured install',
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('rejects malformed bundle versions', () => {
  const result = spawnSync(
    'node',
    [script, '--version', '../escape', '--skip-digests'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid bundle version/);
});

test('locks all component images to the source revision tag', () => {
  const temporary = mkdtempSync(
    path.join(os.tmpdir(), 'moltnet-self-host-source-test-'),
  );
  const output = path.join(temporary, 'bundle');
  const tag = 'self-host-1.0.0-abc123def456';
  try {
    execFileSync(
      'node',
      [
        script,
        '--version',
        '1.0.0',
        '--image-tag',
        tag,
        '--skip-digests',
        '--output',
        output,
      ],
      { cwd: repoRoot, stdio: 'pipe' },
    );
    const releaseEnv = readFileSync(
      path.join(output, 'deploy/self-host/.env.release'),
      'utf8',
    );
    for (const name of [
      'REST_API_IMAGE',
      'MCP_SERVER_IMAGE',
      'CONSOLE_IMAGE',
      'DB_MIGRATE_IMAGE',
    ]) {
      assert.match(releaseEnv, new RegExp(`^${name}=.+:${tag}$`, 'm'));
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('resolves digest pins for source-tagged images', () => {
  const temporary = mkdtempSync(
    path.join(os.tmpdir(), 'moltnet-self-host-digest-test-'),
  );
  const output = path.join(temporary, 'bundle');
  const mockBin = path.join(temporary, 'bin');
  const tag = 'self-host-1.0.0-abc123def456';
  const digest = `sha256:${'a'.repeat(64)}`;
  try {
    const docker = execFileSync('which', ['docker'], {
      encoding: 'utf8',
    }).trim();
    mkdirSync(mockBin);
    const mockDocker = path.join(mockBin, 'docker');
    writeFileSync(
      mockDocker,
      `#!/bin/sh\nif [ "$1" = buildx ] && [ "$2" = imagetools ] && [ "$3" = inspect ]; then\n  printf '%s\\n' '${digest}'\nelse\n  exec "$REAL_DOCKER" "$@"\nfi\n`,
    );
    chmodSync(mockDocker, 0o755);
    execFileSync(
      'node',
      [script, '--version', '1.0.0', '--image-tag', tag, '--output', output],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${mockBin}${path.delimiter}${process.env.PATH}`,
          REAL_DOCKER: docker,
        },
        stdio: 'pipe',
      },
    );
    const releaseEnv = readFileSync(
      path.join(output, 'deploy/self-host/.env.release'),
      'utf8',
    );
    for (const name of [
      'REST_API_IMAGE',
      'MCP_SERVER_IMAGE',
      'CONSOLE_IMAGE',
      'DB_MIGRATE_IMAGE',
    ]) {
      assert.match(releaseEnv, new RegExp(`^${name}=.+@${digest}$`, 'm'));
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
