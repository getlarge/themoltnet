import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  provisionDatabases,
  provisioningFailure,
} from '../../../deploy/ory/provision-databases.mjs';
import { provisionClients } from '../../../deploy/ory/provision-oauth-clients.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const script = path.join(repoRoot, 'tools/release/self-host-bundle.mjs');

// Required Compose variables, filled with placeholders; image pins come from .env.release.
function composeEnvironment(composeDir) {
  const compose = ['compose.yaml', '../ory/compose.yaml']
    .map((file) => readFileSync(path.join(composeDir, file), 'utf8'))
    .join('\n');
  return {
    ...process.env,
    ...Object.fromEntries(
      [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)]
        .filter(([, name]) => !name.endsWith('_IMAGE'))
        .map(([, name]) => [name, 'test-secret']),
    ),
  };
}

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

    // Validate after a real archive roundtrip and delete the assembled tree;
    // every extends reference and bind must survive independently.
    execFileSync('tar', [
      '-czf',
      path.join(temporary, 'bundle.tar.gz'),
      '-C',
      output,
      '.',
    ]);
    rmSync(output, { recursive: true });
    mkdirSync(output);
    execFileSync('tar', [
      '-xzf',
      path.join(temporary, 'bundle.tar.gz'),
      '-C',
      output,
    ]);
    const composeDir = path.join(output, 'deploy/self-host');
    assert.equal(existsSync(path.join(composeDir, '.env')), false);
    assert.equal(
      existsSync(path.join(composeDir, '../ory/provision-oauth-clients.mjs')),
      true,
    );
    assert.equal(
      existsSync(path.join(composeDir, 'compose.tracing.yaml')),
      true,
    );
    // Operators run the shipped sequence directly, so it must stay executable.
    assert.equal(
      statSync(path.join(composeDir, 'maintain.sh')).mode & 0o111,
      0o111,
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
        env: composeEnvironment(composeDir),
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
        env: composeEnvironment(composeDir),
      },
    );
    assert.equal(tracingConfig.status, 0, tracingConfig.stderr);
    const tracingServices = JSON.parse(tracingConfig.stdout).services;
    for (const service of Object.values(tracingServices)) {
      for (const bind of service.volumes ?? []) {
        if (bind.type !== 'bind') continue;
        assert.ok(
          bind.source.startsWith(realpathSync(output) + path.sep),
          bind.source,
        );
        assert.ok(existsSync(bind.source), bind.source);
      }
    }
    assert.equal(tracingServices.hydra.image.includes('@sha256:'), true);
    for (const name of ['kratos', 'hydra', 'keto']) {
      const dsn = new URL(tracingServices[name].environment.DSN);
      assert.equal(dsn.searchParams.get('max_conns'), '10');
      assert.equal(dsn.searchParams.get('max_idle_conns'), '5');
    }
    assert.equal(tracingServices.talos.command[0], 'serve');
    assert.equal(tracingServices.talos.depends_on, undefined);
    for (const name of ['kratos', 'hydra', 'keto', 'talos']) {
      assert.equal(tracingServices[name].ports, undefined);
    }
    const maintenance = execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        '.env.example',
        '--env-file',
        '.env.release',
        '--profile',
        '*',
        'config',
        '--format',
        'json',
      ],
      {
        cwd: composeDir,
        encoding: 'utf8',
        env: composeEnvironment(composeDir),
      },
    );
    for (const name of [
      'ory-db-init',
      'kratos-migrate',
      'hydra-migrate',
      'keto-migrate',
      'talos-init',
      'talos-migrate',
      'hydra-native-client',
    ]) {
      const job = JSON.parse(maintenance).services[name];
      assert.equal(job.restart, 'no');
      assert.deepEqual(job.profiles, ['maintenance']);
    }

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
      'ORY_TOOLS_IMAGE',
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
      'ORY_TOOLS_IMAGE',
    ]) {
      assert.match(releaseEnv, new RegExp(`^${name}=.+@${digest}$`, 'm'));
    }
    const composeDir = path.join(output, 'deploy/self-host');
    const rendered = execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        '.env.example',
        '--env-file',
        '.env.release',
        '--profile',
        '*',
        'config',
        '--format',
        'json',
      ],
      {
        cwd: composeDir,
        encoding: 'utf8',
        env: composeEnvironment(composeDir),
      },
    );
    for (const service of Object.values(JSON.parse(rendered).services)) {
      assert.match(service.image, /@sha256:[a-f0-9]{64}$/, service.image);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('existing Ory databases are verified without changing passwords or app ownership', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM pg_roles'))
        return { rows: [{ rolcanlogin: true }] };
      if (sql.includes('FROM pg_database'))
        return { rows: [{ owner: params[0] }] };
      return { rows: [] };
    },
  };
  await provisionDatabases(
    client,
    { kratos: 'synthetic', hydra: 'synthetic', keto: 'synthetic' },
    () => {},
  );
  assert.ok(!calls.some(({ sql }) => /CREATE|ALTER|moltnet OWNER/.test(sql)));
  assert.ok(calls.every(({ sql }) => !sql.includes('synthetic')));
});

test('Ory provisioning rejects unexpected existing database ownership', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('FROM pg_roles'))
        return { rows: [{ rolcanlogin: true }] };
      if (sql.includes('FROM pg_database'))
        return { rows: [{ owner: 'application' }] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    provisionDatabases(client, { kratos: 'synthetic' }, () => {}),
    /unexpected ownership/,
  );
  assert.ok(!calls.some((sql) => /ALTER|REVOKE/.test(sql)));
  assert.match(calls.at(-1), /pg_advisory_unlock/);
});

test('Ory provisioning reports safe reasons and refuses inherited privileges', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('FROM pg_auth_members'))
        return { rows: [{ member: true }] };
      if (sql.includes('FROM pg_roles'))
        return { rows: [{ rolcanlogin: true }] };
      return { rows: [] };
    },
  };
  // Memberships confer privileges even when the role's own flags are ordinary.
  await assert.rejects(
    provisionDatabases(client, { kratos: 'synthetic' }, () => {}),
    (error) =>
      provisioningFailure(error).includes(
        'kratos: existing role has unexpected membership',
      ),
  );
  assert.ok(!calls.some((sql) => /CREATE|REVOKE|GRANT/.test(sql)));
  assert.match(calls.at(-1), /pg_advisory_unlock/);
  await assert.rejects(
    provisionDatabases(client, {}, () => {}),
    (error) =>
      provisioningFailure(error).includes(
        'kratos: required database password missing',
      ),
  );
  assert.equal(
    provisioningFailure({
      code: '42501',
      message: 'synthetic-sensitive-query',
      detail: 'synthetic-password',
    }),
    'Ory database provisioning failed: PostgreSQL SQLSTATE 42501',
  );
  assert.doesNotMatch(
    provisioningFailure({
      code: 'synthetic-password',
      message: 'synthetic-password',
    }),
    /synthetic-password/,
  );
});

test('Talos initialization locks before generation and cleans failed staging', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'talos-init-test-'));
  const data = path.join(temporary, 'data');
  const bin = path.join(temporary, 'bin');
  const wrapper = path.join(temporary, 'talos.sh');
  mkdirSync(data);
  mkdirSync(bin);
  // Substitute only the mount path; exercise the shipped shell script without
  // introducing a runtime override for production key storage.
  writeFileSync(
    wrapper,
    readFileSync(path.join(repoRoot, 'deploy/ory/talos.sh'), 'utf8').replaceAll(
      '/var/lib/talos',
      data,
    ),
  );
  writeFileSync(
    path.join(bin, 'talos'),
    `#!/bin/sh
if [ "$1" = jwk ]; then
  for destination; do :; done
  printf 'synthetic-jwk' > "$destination"
  [ "\${FAIL_GENERATE:-0}" = 0 ] || exit 1
else
  printf '%s\\n' "$1"
fi
`,
    { mode: 0o755 },
  );
  const run = (mode, extra = {}) =>
    spawnSync('sh', [wrapper, mode], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, ...extra },
    });
  try {
    const lock = path.join(data, '.initialize-lock');
    mkdirSync(lock);
    assert.match(run('init').stderr, /lock exists/);
    assert.ok(
      existsSync(lock),
      'a competing initializer must not remove the lock',
    );
    rmSync(lock, { recursive: true });
    assert.notEqual(run('init', { FAIL_GENERATE: '1' }).status, 0);
    assert.deepEqual(
      readdirSync(data),
      [],
      'failed generation publishes no keys',
    );
    assert.equal(run('init').status, 0);
    const before = readFileSync(path.join(data, 'jwks.json'), 'utf8');
    assert.match(run('init').stderr, /empty volume/);
    assert.equal(readFileSync(path.join(data, 'jwks.json'), 'utf8'), before);
    assert.match(run('serve').stderr, /database missing/);
    rmSync(path.join(data, 'hmac-secret'));
    assert.match(run('migrate').stderr, /key material missing/);
    assert.match(run('init').stderr, /empty volume/);
    assert.equal(run('unknown').status, 2);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('module smoke retains operation diagnostics when teardown also fails', () => {
  const temporary = mkdtempSync(
    path.join(os.tmpdir(), 'ory-smoke-failure-test-'),
  );
  writeFileSync(
    path.join(temporary, 'docker'),
    `#!/bin/sh
case " $* " in
  *' ps '*) echo synthetic-status ;;
  *' logs '*) echo synthetic-service-log ;;
  *' down '*) echo synthetic-cleanup-failure >&2; exit 1 ;;
  *) echo synthetic-startup-failure >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync(
      'node',
      [path.join(repoRoot, 'tools/release/ory-module-smoke.mjs'), repoRoot],
      {
        encoding: 'utf8',
        env: { PATH: `${temporary}:${process.env.PATH}` },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /operation failed: up -d --wait/);
    for (const marker of [
      'startup-failure',
      'status',
      'service-log',
      'cleanup-failure',
    ])
      assert.ok(result.stderr.includes(`synthetic-${marker}`));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('maintenance script runs each sequence in order and stops at a failed step', () => {
  // Arrange
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'maintain-test-'));
  const bin = path.join(temporary, 'bin');
  const log = path.join(temporary, 'calls.log');
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
case " $* " in *" \${FAIL_ON:-none} "*) exit 1 ;; esac
`,
    { mode: 0o755 },
  );
  const maintain = (args, failOn) => {
    rmSync(log, { force: true });
    const result = spawnSync(
      'bash',
      [path.join(repoRoot, 'deploy/self-host/maintain.sh'), ...args],
      {
        encoding: 'utf8',
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          ...(failOn ? { FAIL_ON: failOn } : {}),
        },
      },
    );
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n')
      : [];
    return { status: result.status, calls };
  };
  try {
    // Act
    const init = maintain(['init', '-p', 'demo']);
    const upgrade = maintain(['upgrade']);
    const stopped = maintain(['init'], 'talos-init');
    const usage = maintain(['repair']);

    // Assert
    assert.equal(init.status, 0);
    assert.deepEqual(init.calls, [
      'compose -p demo config --quiet',
      'compose -p demo up -d --wait --wait-timeout 300 postgres',
      'compose -p demo run --rm --no-deps ory-db-init',
      'compose -p demo run --rm --no-deps talos-init',
      'compose -p demo run --rm --no-deps kratos-migrate',
      'compose -p demo run --rm --no-deps hydra-migrate',
      'compose -p demo run --rm --no-deps keto-migrate',
      'compose -p demo run --rm --no-deps talos-migrate',
      'compose -p demo up -d --wait --wait-timeout 300',
      'compose -p demo run --rm --no-deps hydra-native-client',
      'compose -p demo ps --all',
    ]);
    assert.equal(upgrade.status, 0);
    assert.equal(upgrade.calls[0], 'compose --env-file .env config --quiet');
    assert.ok(
      !upgrade.calls.some((call) => /ory-db-init|talos-init/.test(call)),
    );
    assert.ok(
      upgrade.calls.indexOf(
        'compose --env-file .env stop caddy console mcp-server rest-api kratos-ui kratos hydra keto talos',
      ) <
        upgrade.calls.indexOf(
          'compose --env-file .env run --rm --no-deps kratos-migrate',
        ),
    );
    assert.notEqual(stopped.status, 0);
    assert.equal(
      stopped.calls.at(-1),
      'compose --env-file .env run --rm --no-deps talos-init',
    );
    assert.equal(usage.status, 2);
    assert.deepEqual(usage.calls, []);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
