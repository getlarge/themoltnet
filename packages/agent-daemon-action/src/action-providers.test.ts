/**
 * Executes the `providers` shell block from action.yml against a fake
 * `moltnet-agent` to pin the provider-configuration contract:
 *
 * - each line configures one provider; the API key is piped on stdin from
 *   the named environment variable, never passed as an argument;
 * - models are discovered unless the provider cache was restored;
 * - an empty discovery fails the step so it is never cached.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = parse(
  readFileSync(resolve(packageRoot, 'action.yml'), 'utf8'),
) as {
  inputs: Record<string, { default?: string }>;
  runs: { steps: { id?: string; if?: string; name?: string; run?: string }[] };
};

function step(id: string) {
  const found = action.runs.steps.find((candidate) => candidate.id === id);
  if (!found?.run) throw new Error(`Missing action step id: ${id}`);
  return found as { id: string; run: string; if?: string };
}

let root: string;
let log: string;
let agent: string;

/** Fake agent: logs argv and stdin; `discover` prints $FAKE_MODELS models. */
function installFakeAgent() {
  agent = resolve(root, 'moltnet-agent');
  writeFileSync(
    agent,
    [
      '#!/usr/bin/env bash',
      'stdin=""',
      'if [[ " $* " == *" --api-key-stdin "* ]]; then stdin="$(cat)"; fi',
      `printf '%s|stdin=%s\\n' "$*" "$stdin" >> "${log}"`,
      'if [ "$2" = discover ]; then',
      '  models=""',
      '  for ((i = 1; i <= ${FAKE_MODELS:-2}; i++)); do models="$models{\\"id\\":\\"m$i\\"},"; done',
      '  printf \'{"models":[%s]}\' "${models%,}"',
      'fi',
    ].join('\n'),
  );
  chmodSync(agent, 0o755);
}

function runProviders(env: Record<string, string>) {
  return spawnSync('bash', ['-c', step('providers').run], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: root,
      DAEMON_VERSION: 'latest',
      MOLTNET_AGENT_BIN: agent,
      CACHE_HIT: 'false',
      ...env,
    },
  });
}

function calls(): string[] {
  try {
    return readFileSync(log, 'utf8').trim().split('\n');
  } catch {
    return [];
  }
}

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'agent-daemon-action-providers-'));
  log = resolve(root, 'calls.log');
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
  it('pipes the API key on stdin and discovers models', () => {
    // Act
    const result = runProviders({
      PROVIDERS: 'ollama-cloud https://ollama.com/v1 OLLAMA_API_KEY\n',
      OLLAMA_API_KEY: 'sk-test',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(calls()).toEqual([
      'providers set ollama-cloud --base-url https://ollama.com/v1 --api openai-completions --api-key-stdin|stdin=sk-test',
      'providers discover ollama-cloud --save --json|stdin=',
    ]);
    expect(calls().join('\n')).not.toContain('sk-test --');
  });

  it('configures a keyless provider with its own API kind', () => {
    // Act
    const result = runProviders({
      PROVIDERS: 'ollama http://localhost:11434/v1 - openai-responses',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(calls()[0]).toBe(
      'providers set ollama --base-url http://localhost:11434/v1 --api openai-responses|stdin=',
    );
  });

  it('skips discovery when the provider cache was restored', () => {
    // Act
    const result = runProviders({
      PROVIDERS: 'ollama-cloud https://ollama.com/v1 OLLAMA_API_KEY',
      OLLAMA_API_KEY: 'sk-test',
      CACHE_HIT: 'true',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toContain('providers set ollama-cloud');
  });

  it('fails when discovery finds no models, so nothing empty is cached', () => {
    // Act
    const result = runProviders({
      PROVIDERS: 'ollama-cloud https://ollama.com/v1 OLLAMA_API_KEY',
      OLLAMA_API_KEY: 'sk-test',
      FAKE_MODELS: '0',
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('discovery found no models');
  });

  it.each([
    [
      'a missing key variable',
      'ollama-cloud https://ollama.com/v1 OLLAMA_API_KEY',
      'needs its API key',
    ],
    ['a malformed line', 'ollama-cloud', 'must be: <id> <base-url>'],
    [
      'a key variable that is not a name',
      'x https://x.test/v1 $(id)',
      'not an environment variable name',
    ],
  ])('rejects %s', (_label, providers, message) => {
    // Act
    const result = runProviders({ PROVIDERS: providers });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(calls()).toEqual([]);
  });

  it('ignores blank lines and comments', () => {
    // Act
    const result = runProviders({
      PROVIDERS: '\n# local models\nollama http://localhost:11434/v1 -\n',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(calls()).toHaveLength(2);
  });
});
