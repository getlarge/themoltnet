import { spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  authenticationReady,
  buildPolicyHookConfiguration,
  minimalProviderEnvironment,
  providerArgs,
  providerDenialObserved,
  toObservedPolicyEvidence,
} from './policy-live-probe.js';
import type { ReplayEvidence } from './policy-replay.js';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(sourceDir, '../../test-fixtures/execution-governance');
const workspaceRoot = join(sourceDir, '../../..');
const liveProbePath = join(sourceDir, 'policy-live-probe.ts');
const tsxPath = join(workspaceRoot, 'node_modules/.bin/tsx');

async function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number | null> {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    env,
    stdio: 'ignore',
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
}

const offlineDenial: ReplayEvidence = {
  runtimeProfileRevision: 1,
  policySnapshotHash: `sha256:${'a'.repeat(64)}`,
  provider: 'codex',
  nativeActionIdentifier: 'exec-test',
  decision: 'deny',
  reasonCode: 'tool_not_permitted',
  decisionLocus: 'offline-replay',
  intendedEnforcementLocus: 'PreToolUse',
  enforcementObserved: false,
  hookResponse: {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'tool_not_permitted',
    },
  },
};

describe('Checkpoint C live policy probe', () => {
  it('passes only non-credential process prerequisites to providers', () => {
    const environment = minimalProviderEnvironment({
      HOME: '/home/probe',
      PATH: '/bin',
      TMPDIR: '/tmp',
      OPENAI_API_KEY: 'not-forwarded',
      ANTHROPIC_API_KEY: 'not-forwarded',
      CODEX_ACCESS_TOKEN: 'not-forwarded',
      CODEX_HOME: '/ambient/codex',
      CLAUDE_CONFIG_DIR: '/ambient/claude',
      HTTPS_PROXY: 'https://credential@proxy.invalid',
    });

    expect(environment).toMatchObject({
      CI: '1',
      NO_COLOR: '1',
      HOME: '/home/probe',
      PATH: '/bin',
      TMPDIR: '/tmp',
    });
    expect(environment).not.toHaveProperty('OPENAI_API_KEY');
    expect(environment).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(environment).not.toHaveProperty('CODEX_ACCESS_TOKEN');
    expect(environment).not.toHaveProperty('CODEX_HOME');
    expect(environment).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    expect(environment).not.toHaveProperty('HTTPS_PROXY');
  });

  it('keeps provider launch details local and avoids moltnet start', () => {
    const codex = providerArgs('codex', '/tmp/evidence.jsonl');
    const claude = providerArgs('claude', '/tmp/evidence.jsonl');

    expect(codex).toEqual(
      expect.arrayContaining([
        '--ignore-user-config',
        '--ignore-rules',
        '--ephemeral',
        '--dangerously-bypass-hook-trust',
        expect.stringContaining('hooks.PreToolUse='),
      ]),
    );
    expect(claude).toEqual(
      expect.arrayContaining([
        '--no-session-persistence',
        '--setting-sources',
        'project',
        '--tools',
        'Bash',
        '{"mcpServers":{}}',
      ]),
    );
    expect([...codex, ...claude].join(' ')).not.toContain('moltnet start');
  });

  it('recognizes each provider authentication status stream', () => {
    expect(
      authenticationReady('codex', {
        code: 0,
        stdout: '',
        stderr: 'Logged in using ChatGPT\n',
      }),
    ).toBe(true);
    expect(
      authenticationReady('claude', {
        code: 0,
        stdout: '{"loggedIn":true}',
        stderr: '',
      }),
    ).toBe(true);
  });

  it('stops the executable probe before provider launch when policy resolution fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moltnet-policy-preflight-'));
    const bin = join(root, 'bin');
    const marker = join(root, 'provider-launched');
    const provider = join(bin, 'codex');
    await mkdir(bin);
    await writeFile(
      provider,
      `#!/bin/sh\nprintf launched > ${JSON.stringify(marker)}\n`,
    );
    await chmod(provider, 0o755);

    try {
      const code = await runProcess(
        tsxPath,
        [
          liveProbePath,
          '--provider',
          'codex',
          '--policy',
          join(root, 'missing-policy.json'),
          '--output',
          join(root, 'evidence'),
        ],
        {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ''}`,
        },
      );

      expect(code).not.toBe(0);
      await expect(readFile(marker, 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['claude', 'codex'] as const)(
    'builds an isolated %s PreToolUse hook command without an auth path',
    (provider) => {
      const configuration = JSON.stringify(
        buildPolicyHookConfiguration(provider, '/tmp/evidence.jsonl'),
      );

      expect(configuration).toContain('PreToolUse');
      expect(configuration).toContain('policy-replay-hook.ts');
      expect(configuration).toContain(`--provider' '${provider}`);
      expect(configuration).not.toContain('auth.json');
      expect(configuration).not.toContain('moltnet.json');
    },
  );

  it('recognizes provider-native denial evidence from retained runs', async () => {
    const claudeStream = await readFile(
      join(
        fixtureDir,
        'observed/claude-2.1.235-macos-arm64/hook-deny/stream.jsonl',
      ),
      'utf8',
    );
    const codexStderr = await readFile(
      join(
        fixtureDir,
        'observed/codex-0.148.0-macos-arm64/hook-deny/stderr.txt',
      ),
      'utf8',
    );

    expect(
      providerDenialObserved('claude', {
        stdout: claudeStream,
        stderr: '',
      }),
    ).toBe(true);
    expect(
      providerDenialObserved('codex', { stdout: '', stderr: codexStderr }),
    ).toBe(true);
  });

  it('promotes evidence only after denial and absent side effects are observed', () => {
    expect(
      toObservedPolicyEvidence(offlineDenial, {
        markerCreated: false,
        providerDenied: true,
      }),
    ).toMatchObject({
      decisionLocus: 'provider-hook',
      enforcementObserved: true,
      nativeActionIdentifier: 'exec-test',
      decision: 'deny',
      reasonCode: 'tool_not_permitted',
    });
    expect(() =>
      toObservedPolicyEvidence(offlineDenial, {
        markerCreated: true,
        providerDenied: true,
      }),
    ).toThrow('provider enforcement was not observed');
    expect(() =>
      toObservedPolicyEvidence(offlineDenial, {
        markerCreated: false,
        providerDenied: false,
      }),
    ).toThrow('provider enforcement was not observed');
  });
});
