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

import { provisionClients } from '../../deploy/self-host/config/provision-oauth-clients.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const script = path.join(repoRoot, 'tools/release/self-host-bundle.mjs');

const nativeClient = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'infra/ory/oauth2-clients/moltnet-native.json'),
    'utf8',
  ),
);
const tailscaleClient = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'infra/ory/oauth2-clients/tailscale-login.json'),
    'utf8',
  ),
);
const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});
const readClient = (file) =>
  JSON.stringify(
    file.includes('tailscale-login') ? tailscaleClient : nativeClient,
  );

test('self-host provisioning updates an existing native client on restart', async () => {
  const calls = [];
  await provisionClients({
    secret: '',
    readFile: readClient,
    output: () => {},
    fetchClient: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/moltnet-native') && !options.method)
        return response(200, nativeClient);
      if (url.endsWith('/moltnet-native') && options.method === 'PUT')
        return response(200, nativeClient);
      throw new Error(`Unexpected Hydra request: ${url}`);
    },
  });
  assert.deepEqual(
    calls.map(({ options }) => options.method ?? 'GET'),
    ['GET', 'PUT'],
  );
  assert.deepEqual(JSON.parse(calls[1].options.body), nativeClient);
});

test('self-host provisioning creates the confidential client without printing its secret', async () => {
  const calls = [];
  const output = [];
  let tailscaleCreated = false;
  await provisionClients({
    secret: 'test-only-confidential-secret',
    readFile: readClient,
    output: (line) => output.push(line),
    fetchClient: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/moltnet-native')) return response(404);
      if (url.endsWith('/tailscale-login'))
        return tailscaleCreated
          ? response(200, tailscaleClient)
          : response(404);
      const body = JSON.parse(options.body);
      if (body.client_id === tailscaleClient.client_id) {
        tailscaleCreated = true;
        return response(201, tailscaleClient);
      }
      return response(201, nativeClient);
    },
  });
  const creation = calls.find(
    ({ options }) =>
      options.method === 'POST' &&
      JSON.parse(options.body).client_id === tailscaleClient.client_id,
  );
  assert.equal(
    JSON.parse(creation.options.body).client_secret,
    'test-only-confidential-secret',
  );
  assert.match(output.join(''), /Created tailscale-login/);
  assert.doesNotMatch(output.join(''), /test-only-confidential-secret/);
  assert.ok(calls.every(({ options }) => options.signal));
});

test('self-host provisioning verifies an existing client without replacing its secret', async () => {
  const calls = [];
  const output = [];
  await provisionClients({
    secret: 'test-only-confidential-secret',
    readFile: readClient,
    output: (line) => output.push(line),
    fetchClient: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/moltnet-native')) return response(404);
      if (url.endsWith('/tailscale-login'))
        return response(200, {
          ...tailscaleClient,
          authorization_code_grant_access_token_lifespan: '300s',
          grant_types: [...tailscaleClient.grant_types].reverse(),
        });
      return response(201, nativeClient);
    },
  });
  assert.equal(
    calls.filter(({ options }) => options.method === 'POST').length,
    1,
  );
  assert.match(
    output.join(''),
    /Verified existing tailscale-login \(secret unchanged\)/,
  );
});

test('self-host provisioning compares object policy fields structurally', async () => {
  const expected = { ...tailscaleClient, metadata: { owner: 'test' } };
  await provisionClients({
    secret: 'test-only-confidential-secret',
    readFile: (file) =>
      JSON.stringify(
        file.includes('tailscale-login') ? expected : nativeClient,
      ),
    output: () => {},
    fetchClient: async (url, options) => {
      if (url.endsWith('/moltnet-native')) return response(404);
      if (url.endsWith('/tailscale-login'))
        return response(200, { ...expected, metadata: { owner: 'test' } });
      if (options.method === 'POST') return response(201, nativeClient);
      throw new Error(`Unexpected Hydra request: ${url}`);
    },
  });
});

test('self-host provisioning fails with the drifted field name', async () => {
  await assert.rejects(
    provisionClients({
      secret: 'test-only-confidential-secret',
      readFile: readClient,
      output: () => {},
      fetchClient: async (url) => {
        if (url.endsWith('/moltnet-native')) return response(404);
        if (url.endsWith('/tailscale-login'))
          return response(200, { ...tailscaleClient, scope: 'openid' });
        return response(201, nativeClient);
      },
    }),
    /client policy differs: scope/,
  );
});

test('self-host provisioning tolerates a concurrent client create', async () => {
  let lookups = 0;
  const output = [];
  await provisionClients({
    secret: 'test-only-confidential-secret',
    readFile: readClient,
    output: (line) => output.push(line),
    fetchClient: async (url, options) => {
      if (url.endsWith('/moltnet-native')) return response(404);
      if (url.endsWith('/tailscale-login'))
        return ++lookups === 1 ? response(404) : response(200, tailscaleClient);
      const body = JSON.parse(options.body);
      return body.client_id === tailscaleClient.client_id
        ? response(409)
        : response(201, nativeClient);
    },
  });
  assert.equal(lookups, 2);
  assert.match(output.join(''), /Verified existing tailscale-login/);
});

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
      existsSync(path.join(composeDir, 'config/provision-oauth-clients.mjs')),
      true,
    );
    assert.equal(
      existsSync(path.join(composeDir, 'compose.tracing.yaml')),
      true,
    );
    assert.equal(
      existsSync(
        path.join(output, 'infra/ory/oauth2-clients/moltnet-native.json'),
      ),
      true,
    );
    assert.equal(
      existsSync(
        path.join(output, 'infra/ory/oauth2-clients/tailscale-login.json'),
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
    const tracingConfig = spawnSync(
      'docker',
      [
        'compose',
        '--env-file',
        '.env.example',
        '--env-file',
        '.env.release',
        '-f',
        'compose.yaml',
        '-f',
        'compose.tracing.yaml',
        'config',
        '--format',
        'json',
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
    assert.equal(tracingConfig.status, 0, tracingConfig.stderr);
    const tracingServices = JSON.parse(tracingConfig.stdout).services;
    for (const name of ['kratos', 'hydra', 'keto']) {
      assert.equal(tracingServices[name].environment.TRACING_PROVIDER, 'otel');
      assert.equal(
        tracingServices[name].environment.TRACING_PROVIDERS_OTLP_SERVER_URL,
        'otel-collector:4318',
      );
    }

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
