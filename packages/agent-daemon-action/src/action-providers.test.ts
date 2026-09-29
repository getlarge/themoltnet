/**
 * Executes the provider steps from action.yml against a fake `moltnet-agent`
 * to pin the provider-configuration contract:
 *
 * - each line configures one provider; the API key reaches the CLI on stdin,
 *   never on argv, and is masked in the log;
 * - models are discovered unless a restored cache already holds them;
 * - an empty discovery fails the step, and a partial one is not cached.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

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
let agent: string;
let output: string;

/**
 * Fake agent: logs argv to argv.log and stdin to stdin.log (one line per
 * call). `providers list` reports $FAKE_KNOWN models; `discover` prints
 * $FAKE_MODELS models and $FAKE_FAILURES endpoint failures, and exits
 * $FAKE_DISCOVER_CODE.
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
      'if [ "$2" = list ]; then',
      '  models=""',
      '  for ((i = 1; i <= ${FAKE_KNOWN:-0}; i++)); do models="$models{\\"id\\":\\"m$i\\"},"; done',
      '  printf \'{"configuredProviders":{"%s":{"models":[%s]}}}\' "${FAKE_ID:-ollama-cloud}" "${models%,}"',
      'fi',
      'if [ "$2" = discover ]; then',
      '  models=""',
      '  for ((i = 1; i <= ${FAKE_MODELS:-2}; i++)); do models="$models{\\"id\\":\\"m$i\\"},"; done',
      '  failures=""',
      '  for ((i = 1; i <= ${FAKE_FAILURES:-0}; i++)); do failures="$failures{\\"kind\\":\\"network\\"},"; done',
      '  printf \'{"models":[%s],"failures":[%s]}\' "${models%,}" "${failures%,}"',
      '  exit "${FAKE_DISCOVER_CODE:-0}"',
      'fi',
    ].join('\n'),
  );
}

function runProviders(env: Record<string, string>) {
  return spawnSync(
    'bash',
    ['-c', renderRun(stepById(action, 'providers').run)],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: root,
        GITHUB_OUTPUT: output,
        MOLTNET_AGENT_BIN: agent,
        CACHE_HIT: 'false',
        ...env,
      },
    },
  );
}

const argv = () => readCalls(resolve(root, 'argv.log'));
const stdin = () => readCalls(resolve(root, 'stdin.log'));
const cloud =
  'id=ollama-cloud base-url=https://ollama.com/v1 key-env=OLLAMA_API_KEY';

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'agent-daemon-action-providers-'));
  output = resolve(root, 'github-output');
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

describe('providers step', () => {
  it('pipes the API key on stdin only, masks it, and discovers models', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(argv()).toEqual([
      'providers set ollama-cloud --base-url https://ollama.com/v1 --api openai-completions --api-key-stdin',
      'providers list --json',
      'providers discover ollama-cloud --save --json',
    ]);
    expect(argv().join('\n')).not.toContain('sk-test');
    expect(stdin()).toEqual(['sk-test']);
    expect(result.stdout).toContain('::add-mask::sk-test');
    expect(readFileSync(output, 'utf8')).toContain('cacheable=true');
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
      'providers set openai --base-url https://api.openai.com/v1 --api openai-responses --api-key-stdin',
    );
  });

  it('configures a keyless local provider', () => {
    // Act
    const result = runProviders({
      PROVIDERS: 'id=ollama base-url=http://localhost:11434/v1\r\n',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(argv()[0]).toBe(
      'providers set ollama --base-url http://localhost:11434/v1 --api openai-completions',
    );
    expect(stdin()).toEqual([]);
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
    expect(argv()).toContain('providers discover ollama-cloud --save --json');
  });

  it('does not cache a partial discovery', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
      FAKE_FAILURES: '1',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('discovery was partial');
    expect(readFileSync(output, 'utf8')).toContain('cacheable=false');
  });

  it('fails when discovery finds no models, so nothing empty is cached', () => {
    // Act
    const result = runProviders({
      PROVIDERS: cloud,
      OLLAMA_API_KEY: 'sk-test',
      FAKE_MODELS: '0',
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
    [
      'a key variable that is not a name',
      'id=x base-url=https://x.test/v1 key-env=$(id)',
      {},
      'not an environment variable name',
    ],
    [
      'a platform credential as key',
      'id=x base-url=https://x.test/v1 key-env=GITHUB_TOKEN',
      { GITHUB_TOKEN: 'ghs_x' },
      'cannot use GITHUB_TOKEN',
    ],
    [
      'a plain http public endpoint',
      'id=x base-url=http://x.test/v1 key-env=X_KEY',
      { X_KEY: 'k' },
      'must use https',
    ],
  ])(
    'rejects %s before calling the agent',
    (_label, providers, env, message) => {
      // Act
      const result = runProviders({ PROVIDERS: providers, ...env });

      // Assert
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect(argv()).toEqual([]);
    },
  );

  it('accepts a lowercase key variable name', () => {
    // Act
    const result = runProviders({
      PROVIDERS: 'id=x base-url=https://x.test/v1 key-env=my_key',
      my_key: 'k',
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

  it('writes PI_AUTH_JSON into the provider store alongside providers', () => {
    // Arrange
    const step = action.runs.steps.find((candidate) =>
      candidate.name?.startsWith('Materialize Pi auth.json'),
    );

    // Act
    const result = spawnSync('bash', ['-c', renderRun(step?.run ?? '')], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: root,
        PROVIDERS: cloud,
        PI_AUTH_JSON: '{"openai-codex":{}}',
      },
    });

    // Assert
    expect(result.status).toBe(0);
    expect(
      readFileSync(resolve(root, '.config/moltnet/pi/auth.json'), 'utf8'),
    ).toBe('{"openai-codex":{}}');
  });
});
