import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  assertCredentialAbsent,
  CleanupStack,
  type CommandResult,
  DockerSandboxCredentialAdapter,
  normalizeDockerVersion,
  normalizeEffectivePolicy,
  sanitizeCredentialEvidence,
} from './docker-sandbox-credential-adapter.js';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const scenariosPath = join(
  sourceDir,
  '../../test-fixtures/execution-governance/scenarios.json',
);

function commandResult(input: Partial<CommandResult> = {}): CommandResult {
  return {
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    durationMs: 1,
    ...input,
  };
}

describe('Docker Sandbox credential probe adapter', () => {
  it('fails a missing required binding before invoking sbx', async () => {
    const runner = vi.fn();
    const adapter = new DockerSandboxCredentialAdapter(runner);

    const readiness = await adapter.preflight({
      id: 'fixture.http.bearer',
      required: true,
      consumer: 'sandbox-http-client',
      destination: 'fixture.allowed',
      acceptableDelivery: 'brokered-http-request',
    });

    expect(readiness).toMatchObject({
      ready: false,
      bindingReady: false,
      failures: [{ code: 'required_binding_missing' }],
    });
    expect(readiness.failures[0]?.instruction).toContain('fixture.http.bearer');
    expect(runner).not.toHaveBeenCalled();
  });

  it('normalizes version and effective destination decisions', () => {
    expect(normalizeDockerVersion('sbx version: v0.39.0 abc')).toBe('v0.39.0');
    expect(
      normalizeEffectivePolicy({
        policyJson: JSON.stringify({
          rules: [
            {
              id: 'default-deny-all',
              origin: 'local',
              status: 'active',
              resource_type: 'network',
            },
            {
              id: 'allow-fixture',
              origin: 'local',
              status: 'active',
              resource_type: 'network',
            },
          ],
        }),
        destination: 'localhost:41000',
        destinationCheck: commandResult({ stdout: 'Allowed' }),
        wrongDestination: 'localhost:41001',
        wrongDestinationCheck: commandResult({ stdout: 'Denied' }),
      }),
    ).toMatchObject({
      source: 'local',
      preset: 'deny-all',
      destinationDecision: 'allow',
      wrongDestinationDecision: 'deny',
    });
  });

  it('injects only the configured stand-in when executing a scenario', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = vi.fn(async (command: string, args: string[]) => {
      calls.push({ command, args });
      return commandResult();
    });
    const adapter = new DockerSandboxCredentialAdapter(runner);

    await adapter.bindCredential({
      sandbox: 'synthetic-sandbox',
      destinationHosts: ['fixture.invalid'],
      envName: 'SYNTHETIC_API_KEY',
      resolverCommand: 'resolve-synthetic-fixture',
      standIn: 'stand-in-only',
    });
    await adapter.exec({
      sandbox: 'synthetic-sandbox',
      command: 'fixture-client',
      args: [],
    });

    expect(calls[1]).toEqual({
      command: 'sbx',
      args: [
        'exec',
        '--env',
        'SYNTHETIC_API_KEY=stand-in-only',
        'synthetic-sandbox',
        'fixture-client',
      ],
    });
    expect(calls.flatMap(({ args }) => args)).not.toContain(
      'MOLTNET_M01_SYNTHETIC_TEST',
    );
  });

  it('runs cleanup in reverse order and continues after a failure', async () => {
    const calls: string[] = [];
    const cleanup = new CleanupStack();
    cleanup.add('first', async () => {
      calls.push('first');
    });
    cleanup.add('second', async () => {
      calls.push('second');
      throw new Error('fixture failure');
    });

    const errors = await cleanup.run();

    expect(calls).toEqual(['second', 'first']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('second');
  });

  it('redacts defensively and rejects raw leaked evidence', () => {
    const credential = 'MOLTNET_M01_SYNTHETIC_TEST';

    expect(
      sanitizeCredentialEvidence(`header=${credential}`, [credential]),
    ).toBe('header=$REDACTED_CREDENTIAL');
    expect(() =>
      assertCredentialAbsent(credential, [
        { name: 'stdout', value: 'safe' },
        { name: 'hook', value: credential },
      ]),
    ).toThrow('hook');
  });

  it('keeps shared scenario vocabulary free of Docker commands and hosts', async () => {
    const raw = await readFile(scenariosPath, 'utf8');
    const fixture = JSON.parse(raw) as {
      credentialScenarios: Array<{ id: string; requirement: unknown }>;
    };

    expect(fixture.credentialScenarios.map(({ id }) => id)).toEqual([
      'credential-missing-binding',
      'credential-allowed-destination',
      'credential-wrong-destination',
    ]);
    expect(raw.toLowerCase()).not.toContain('docker');
    expect(raw.toLowerCase()).not.toContain('sbx');
    expect(raw).not.toContain('host.docker.internal');
  });
});
