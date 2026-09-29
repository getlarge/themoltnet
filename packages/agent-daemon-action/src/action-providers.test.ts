/**
 * Executes the provider steps from action.yml against a fake `moltnet-agent`
 * to pin the provider-configuration contract:
 *
 * - each line configures one provider in the resolved store (`--root`); the
 *   API key reaches the CLI on stdin, never on argv, and is masked first;
 * - a keyless line clears any key the store still references;
 * - models are discovered unless a restored cache already holds them;
 * - an empty discovery fails the step; a partial one is not cached and never
 *   replaces a complete model list;
 * - the cleanup clears every stored key through the CLI and removes Pi auth.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import type { DiscoveredModels } from '@moltnet/agent-daemon-api-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadAction,
  readCalls,
  renderRun,
  stepById,
  writeExecutable,
} from './test-support.js';

const action = loadAction();

let root: string;
let store: string;
let agent: string;
let output: string;

/** The daemon's `providers discover --json` output, typed by its schema. */
function discovered(overrides: Partial<DiscoveredModels> = {}): string {
  const result: DiscoveredModels = {
    models: [{ id: 'm1' }, { id: 'm2' }],
    failures: [],
    probeFailures: [],
    ...overrides,
  };
  return JSON.stringify(result);
}

/**
 * Fake agent: logs argv to argv.log and stdin to stdin.log (one line per
 * call). `set` creates providers.json when missing; `providers list` reports
 * $FAKE_KNOWN models; `discover` writes `discovered` into providers.json,
 * prints $FAKE_DISCOVERED, and exits $FAKE_DISCOVER_CODE.
 */
function installFakeAgent() {
  agent = resolve(root, 'moltnet-agent');
  writeExecutable(
    agent,
    [
      `printf '%s\\n' "$*" >> "${root}/argv.log"`,
      'if [[ " $* " == *" --api-key-stdin "* ]]; then',
      `  printf '%s\\n' "$(cat)" >> "${root}/stdin.log"`,
      'fi',
      'store=""',
      'args=("$@")',
      'for ((i = 0; i < ${#args[@]}; i++)); do',
      '  [ "${args[$i]}" = --root ] && store="${args[$((i + 1))]}"',
      'done',
      'if [ "$2" = set ] && [ -n "$store" ] && [ ! -f "$store/providers.json" ]; then',
      '  mkdir -p "$store" && printf "set" > "$store/providers.json"',
      'fi',
      'if [ "$2" = list ]; then',
      '  models=""',
      '  for ((i = 1; i <= ${FAKE_KNOWN:-0}; i++)); do models="$models{\\"id\\":\\"m$i\\"},"; done',
      '  printf \'{"configuredProviders":{"%s":{"models":[%s]}}}\' "${FAKE_ID:-ollama-cloud}" "${models%,}"',
      'fi',
      'if [ "$2" = discover ]; then',
      '  printf "discovered" > "$store/providers.json"',
      '  printf "%s" "$FAKE_DISCOVERED"',
      '  exit "${FAKE_DISCOVER_CODE:-0}"',
      'fi',
    ].join('\n'),
  );
}

function runStep(id: string, env: Record<string, string>) {
  return spawnSync('bash', ['-c', renderRun(stepById(action, id).run)], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: root,
      RUNNER_TEMP: root,
      GITHUB_OUTPUT: output,
      ...env,
    },
  });
}

function runProviders(env: Record<string, string>) {
  return runStep('providers', {
    AGENT_BIN: agent,
    STORE: store,
    CACHE_HIT: 'false',
    FAKE_DISCOVERED: discovered(),
    ...env,
  });
}

function outputs(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(output, 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );
}

const argv = () => readCalls(resolve(root, 'argv.log'));
const stdin = () => readCalls(resolve(root, 'stdin.log'));
const cloud =
  'id=ollama-cloud base-url=https://ollama.com/v1 key-env=OLLAMA_API_KEY';

beforeEach(() => {
  root = realpathSync(
    mkdtempSync(resolve(tmpdir(), 'agent-daemon-action-providers-')),
  );
  store = resolve(root, 'store');
  output = resolve(root, 'github-output');
  writeFileSync(output, '');
  installFakeAgent();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('providers input', () => {
  it('is optional and empty by default', () => {
    expect(action.inputs.providers).toMatchObject({ default: '' });
  });

  it('stops forcing the Pi agent dir when providers are configured', () => {
    const agentDir = action.runs.steps.find(
      (candidate) => candidate.name === 'Configure Pi agent dir',
    );
    expect(agentDir?.if).toBe("inputs.providers == ''");
  });
});

describe('provider store', () => {
  it('defaults to ~/.config/moltnet and reports a fresh store', () => {
    // Act
    const result = runStep('store', {});

    // Assert
    expect(result.status).toBe(0);
    expect(outputs()).toEqual({
      path: resolve(root, '.config/moltnet'),
      existing: 'false',
    });
  });

  it('prefers MOLTNET_HOME, canonicalized like the daemon does', () => {
    // Arrange
    const real = resolve(root, 'real');
    mkdirSync(real);
    symlinkSync(real, resolve(root, 'link'));

    // Act
    const result = runStep('store', {
      MOLTNET_HOME: resolve(root, 'link'),
      MOLTNET_AGENT_SERVER_ROOT: real,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(outputs().path).toBe(real);
  });

  it('refuses MOLTNET_HOME and MOLTNET_AGENT_SERVER_ROOT naming different stores', () => {
    // Act
    const result = runStep('store', {
      MOLTNET_HOME: resolve(root, 'a'),
      MOLTNET_AGENT_SERVER_ROOT: resolve(root, 'b'),
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('name different stores');
  });

  it('marks a store that already has providers, so the cache leaves it alone', () => {
    // Arrange
    mkdirSync(store);
    writeFileSync(resolve(store, 'providers.json'), '{}');

    // Act
    runStep('store', { MOLTNET_HOME: store });

    // Assert
    expect(outputs().existing).toBe('true');
    const restore = action.runs.steps.find(
      (step) => step.id === 'restore-providers',
    );
    const save = action.runs.steps.find(
      (step) => step.name === 'Save provider cache',
    );
    expect(restore?.if).toContain("steps.store.outputs.existing != 'true'");
    expect(save?.if).toContain("steps.store.outputs.existing != 'true'");
  });
});

describe('providers step', () => {
  it('pipes the API key on stdin only, masks it first, and discovers models', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(argv()).toEqual([
      `providers set ollama-cloud --base-url https://ollama.com/v1 --api openai-completions --root ${store} --api-key-stdin`,
      `providers list --json --root ${store}`,
      `providers discover ollama-cloud --save --json --root ${store}`,
    ]);
    expect(argv().join('\n')).not.toContain('sk-test');
    expect(stdin()).toEqual(['sk-test']);
    const lines = result.stdout.split('\n');
    const mask = lines.indexOf('::add-mask::sk-test');
    expect(mask).toBeGreaterThanOrEqual(0);
    // Nothing the step printed before the mask mentions the key.
    expect(lines.slice(0, mask).join('\n')).not.toContain('sk-test');
    expect(outputs().cacheable).toBe('true');
  });

  it('keeps each key with its own provider', () => {
    // Act
    const result = runProviders({
      PROVIDERS: `${cloud}\nid=openai base-url=https://api.openai.com/v1 key-env=OPENAI_API_KEY api=openai-responses\n`,
      OLLAMA_API_KEY: 'sk-ollama',
      OPENAI_API_KEY: 'sk-openai',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(stdin()).toEqual(['sk-ollama', 'sk-openai']);
    expect(argv()).toContain(
      `providers set openai --base-url https://api.openai.com/v1 --api openai-responses --root ${store} --api-key-stdin`,
    );
  });

  it('clears any stored key for a keyless provider', () => {
    // Act
    const result = runProviders({
      PROVIDERS: 'id=ollama base-url=http://localhost:11434/v1\r\n',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(argv()[0]).toBe(
      `providers set ollama --base-url http://localhost:11434/v1 --api openai-completions --root ${store} --clear-api-key`,
    );
    expect(stdin()).toEqual([]);
  });

  it('records each configured provider for the cleanup', () => {
    // Act
    runProviders({
      PROVIDERS: `${cloud}\nid=ollama base-url=http://127.0.0.1:11434/v1`,
      OLLAMA_API_KEY: 'sk-test',
    });

    // Assert
    expect(readCalls(resolve(root, 'moltnet-configured-providers'))).toEqual([
      'ollama-cloud',
      'ollama',
    ]);
  });

  it('skips discovery when a restored cache holds models for the provider', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
      CACHE_HIT: 'true',
      FAKE_KNOWN: '3',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(argv().some((call) => call.includes('discover'))).toBe(false);
  });

  it('rediscovers when a restored cache holds no models for the provider', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
      CACHE_HIT: 'true',
      FAKE_KNOWN: '0',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(argv()).toContain(
      `providers discover ollama-cloud --save --json --root ${store}`,
    );
  });

  it.each([
    [
      'an endpoint failure',
      { failures: [{ kind: 'http' as const, status: 503 }] },
    ],
    [
      'a capability probe failure',
      {
        probeFailures: [
          { kind: 'network' as const, errorType: 'TimeoutError' },
        ],
      },
    ],
  ])('uses but does not cache a discovery with %s', (_label, partial) => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
      FAKE_DISCOVERED: discovered(partial),
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('using it for this run only');
    expect(readFileSync(resolve(store, 'providers.json'), 'utf8')).toBe(
      'discovered',
    );
    expect(outputs().cacheable).toBe('false');
  });

  it('keeps a complete model list when a new discovery is partial', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
      FAKE_KNOWN: '4',
      FAKE_DISCOVERED: discovered({
        failures: [{ kind: 'network', errorType: 'TypeError' }],
      }),
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('keeping its 4 known models');
    // The fake's `set` wrote "set"; discovery's "discovered" was rolled back.
    expect(readFileSync(resolve(store, 'providers.json'), 'utf8')).toBe('set');
    expect(outputs().cacheable).toBe('false');
  });

  it('treats an older daemon without failure fields as complete', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
      FAKE_DISCOVERED: '{"models":[{"id":"m1"}]}',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(outputs().cacheable).toBe('true');
  });

  it('fails when discovery finds no models, so nothing empty is cached', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
      FAKE_DISCOVERED: discovered({ models: [] }),
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('discovery found no models');
  });

  it('fails when discovery itself fails', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
      FAKE_DISCOVER_CODE: '1',
    });

    // Assert
    expect(result.status).not.toBe(0);
  });

  it.each([
    ['a missing key variable', cloud, {}, 'needs its API key'],
    [
      'an empty key variable',
      cloud,
      { OLLAMA_API_KEY: '' },
      'needs its API key',
    ],
    [
      'a multi-line key',
      cloud,
      { OLLAMA_API_KEY: 'sk-a\n::warning::b' },
      'spans several lines',
    ],
    [
      'a line without an id',
      'base-url=https://x.test/v1',
      {},
      'needs id= and base-url=',
    ],
    [
      'an unknown token',
      `${cloud} models=a,b`,
      { OLLAMA_API_KEY: 'k' },
      "unknown providers token 'models=a,b'",
    ],
  ])('rejects %s before sending a key', (_label, providers, env, message) => {
    // Act
    const result = runProviders({ PROVIDERS: providers, ...env });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(stdin()).toEqual([]);
  });

  it.each([
    ['a command substitution', '$(id)', {}],
    ['a lowercase name', 'my_api_key', { my_api_key: 'k' }],
    ['a token that is not an API key', 'NPM_TOKEN', { NPM_TOKEN: 'k' }],
    ['the GitHub CLI token', 'GH_TOKEN', { GH_TOKEN: 'k' }],
    [
      'a cloud credential',
      'AWS_SECRET_ACCESS_KEY',
      { AWS_SECRET_ACCESS_KEY: 'k' },
    ],
    ['Pi subscription auth', 'PI_AUTH_JSON', { PI_AUTH_JSON: '{}' }],
  ])('rejects %s as key-env', (_label, keyEnv, env) => {
    // Act
    const result = runProviders({
      PROVIDERS: `id=x base-url=https://x.test/v1 key-env=${keyEnv}`,
      ...env,
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must name a *_API_KEY variable');
    expect(argv()).toEqual([]);
  });

  it.each(['GITHUB_API_KEY', 'MOLTNET_API_KEY', 'RUNNER_API_KEY'])(
    'rejects the platform-prefixed %s even with the right suffix',
    (keyEnv) => {
      // Act
      const result = runProviders({
        PROVIDERS: `id=x base-url=https://x.test/v1 key-env=${keyEnv}`,
        [keyEnv]: 'k',
      });

      // Assert
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`cannot use ${keyEnv}`);
      expect(argv()).toEqual([]);
    },
  );

  it.each([
    'http://x.test/v1',
    'http://127.evil.example/v1',
    'http://127.0.0.1.evil.example/v1',
    'http://localhost.evil.example/v1',
    'http://localhost@evil.example/v1',
    'http://127.0.0.1@evil.example/v1',
    'http://[::1].evil.example/v1',
    'ftp://ollama.com/v1',
  ])('refuses a key over plain http to %s', (baseUrl) => {
    // Act
    const result = runProviders({
      PROVIDERS: `id=x base-url=${baseUrl} key-env=X_API_KEY`,
      X_API_KEY: 'k',
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must use https');
    expect(argv()).toEqual([]);
  });

  it.each([
    'https://ollama.com/v1',
    'http://localhost',
    'http://localhost:11434/v1',
    'http://127.0.0.1:11434/v1',
    'http://127.1.2.3/v1',
    'http://[::1]:11434/v1',
  ])('accepts %s', (baseUrl) => {
    // Act
    const result = runProviders({
      PROVIDERS: `id=x base-url=${baseUrl} key-env=X_API_KEY`,
      X_API_KEY: 'k',
    });

    // Assert
    expect(result.status).toBe(0);
  });

  it('ignores blank lines and comments', () => {
    // Act
    const result = runProviders({
      PROVIDERS:
        '\n# local models\nid=ollama base-url=http://127.0.0.1:11434/v1\n',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(argv()[0]).toContain('providers set ollama');
  });
});

describe('provider cache key', () => {
  it('changes with the daemon version and the providers, not between runs', () => {
    // Arrange
    const key = (providers: string, version: string) => {
      writeFileSync(output, '');
      runStep('providers-cache-key', {
        PROVIDERS: providers,
        DAEMON_RESOLVED: version,
        RUNNER_OS_NAME: 'Linux',
      });
      return outputs().value;
    };

    // Act
    const base = key(cloud, '1.2.3');

    // Assert
    expect(base).toMatch(
      /^Linux-agent-daemon-providers-v1-1\.2\.3-[0-9a-f]{16}-\d{4}-\d{2}$/,
    );
    expect(key(cloud, '1.2.3')).toBe(base);
    expect(key(cloud, '1.2.4')).not.toBe(base);
    expect(key(`${cloud}\n`, '1.2.3')).not.toBe(base);
  });
});

describe('daemon command', () => {
  it('refuses providers when the daemon version cannot be determined', () => {
    // Arrange: a release binary that does not answer --version.
    const silent = resolve(root, 'silent-agent');
    writeExecutable(silent, 'exit 1');

    // Act
    const result = runStep('daemon', {
      DAEMON_VERSION: 'latest',
      MOLTNET_AGENT_BIN: silent,
      PROVIDERS: cloud,
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'cannot determine the agent-daemon version',
    );
  });

  it('outputs the command instead of exporting it to later steps', () => {
    // Arrange
    const versioned = resolve(root, 'versioned-agent');
    writeExecutable(versioned, 'echo "moltnet-agent 1.2.3"');
    const env = resolve(root, 'github-env');
    writeFileSync(env, '');

    // Act
    const result = runStep('daemon', {
      DAEMON_VERSION: 'latest',
      MOLTNET_AGENT_BIN: versioned,
      PROVIDERS: '',
      GITHUB_ENV: env,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(outputs()).toMatchObject({
      bin: versioned,
      version: 'moltnet-agent-1.2.3',
    });
    expect(readFileSync(env, 'utf8')).toBe('');
  });
});

describe('providers checks', () => {
  it('refuses providers when the caller set PI_CODING_AGENT_DIR', () => {
    // Arrange
    const step = action.runs.steps.find(
      (candidate) => candidate.name === 'Check the providers configuration',
    );

    // Act
    const result = spawnSync('bash', ['-c', step?.run ?? ''], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', PI_CODING_AGENT_DIR: '/tmp/pi' },
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('would ignore the providers input');
  });

  function runAuth(env: Record<string, string>) {
    const step = action.runs.steps.find((candidate) =>
      candidate.name?.startsWith('Materialize Pi auth.json'),
    );
    return spawnSync('bash', ['-c', renderRun(step?.run ?? '')], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: root, ...env },
    });
  }

  it('writes PI_AUTH_JSON into the resolved provider store', () => {
    // Act
    const result = runAuth({
      PROVIDERS: cloud,
      STORE: store,
      PI_AUTH_JSON: '{"openai-codex":{}}',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(readFileSync(resolve(store, 'pi/auth.json'), 'utf8')).toBe(
      '{"openai-codex":{}}',
    );
  });

  it('checks a stored PI_AUTH_JSON for expired tokens too', () => {
    // Act
    const result = runAuth({
      PROVIDERS: cloud,
      STORE: store,
      PI_AUTH_JSON: JSON.stringify({ codex: { type: 'oauth', expires: 1 } }),
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      '::error::PI_AUTH_JSON access token expired',
    );
  });
});

describe('provider cleanup', () => {
  function runCleanup(env: Record<string, string>) {
    return runStep('cleanup-providers', {
      STORE: store,
      AGENT_BIN: agent,
      ...env,
    });
  }

  it('clears each configured key through the CLI and removes Pi auth', () => {
    // Arrange
    mkdirSync(resolve(store, 'pi'), { recursive: true });
    writeFileSync(resolve(store, 'pi/auth.json'), '{}');
    writeFileSync(
      resolve(root, 'moltnet-configured-providers'),
      'ollama-cloud\nollama\n',
    );

    // Act
    const result = runCleanup({});

    // Assert
    expect(result.status).toBe(0);
    expect(existsSync(resolve(store, 'pi/auth.json'))).toBe(false);
    expect(argv()).toEqual([
      `providers set ollama-cloud --clear-api-key --root ${store}`,
      `providers set ollama --clear-api-key --root ${store}`,
    ]);
  });

  it('still removes Pi auth when the daemon was never resolved', () => {
    // Arrange
    mkdirSync(resolve(store, 'pi'), { recursive: true });
    writeFileSync(resolve(store, 'pi/auth.json'), '{}');

    // Act
    const result = runCleanup({ AGENT_BIN: '' });

    // Assert
    expect(result.status).toBe(0);
    expect(existsSync(resolve(store, 'pi/auth.json'))).toBe(false);
    expect(argv()).toEqual([]);
  });

  it('runs whenever the store was resolved, even after a failure', () => {
    // Act
    const step = action.runs.steps.find(
      (candidate) => candidate.id === 'cleanup-providers',
    );

    // Assert
    expect(step?.if).toBe(
      "always() && inputs.providers != '' && steps.store.outputs.path != ''",
    );
  });
});
