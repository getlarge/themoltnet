import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  launchAfterPolicyResolution,
  loadPolicyReplayFixture,
  loadRetainedPreToolUse,
  type ProviderPreToolUseResponse,
  type ReplayPayload,
  replayPreToolUse,
  type ReplayProvider,
} from './policy-replay.js';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(sourceDir, '../../test-fixtures/execution-governance');
const fixturePath = join(fixtureDir, 'policy-replay.json');
const hookPath = join(sourceDir, 'policy-replay-hook.ts');

function expectAcceptedProviderResponse(
  provider: ReplayProvider,
  response: ProviderPreToolUseResponse,
  expectedDecision: 'allow' | 'deny',
): void {
  if (expectedDecision === 'allow') {
    expect(response, `${provider} allowance response`).toEqual({});
    return;
  }
  switch (provider) {
    case 'claude':
    case 'codex':
      expect(response).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: expect.any(String),
        },
      });
  }
  expect(response).not.toHaveProperty('decision', 'deny');
}

async function spawnPolicyHook(
  provider: ReplayProvider,
  payload: ReplayPayload,
): Promise<{ evidence: unknown; stderr: string; stdout: string }> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'moltnet-policy-hook-'),
  );
  const evidencePath = join(temporaryDirectory, 'evidence.jsonl');
  try {
    const childEnvironment = { ...process.env };
    delete childEnvironment.FORCE_COLOR;
    delete childEnvironment.NO_COLOR;
    const result = await new Promise<{
      exitCode: number | null;
      stderr: string;
      stdout: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          hookPath,
          '--provider',
          provider,
          '--policy',
          fixturePath,
          '--evidence',
          evidencePath,
        ],
        { env: childEnvironment, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (stdout += chunk));
      child.stderr.on('data', (chunk: string) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (exitCode) => resolve({ exitCode, stderr, stdout }));
      child.stdin.end(JSON.stringify(payload));
    });
    expect(result.exitCode).toBe(0);
    const evidenceLines = (await readFile(evidencePath, 'utf8'))
      .trim()
      .split('\n');
    expect(evidenceLines).toHaveLength(1);
    return {
      evidence: JSON.parse(evidenceLines[0]),
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

describe('offline Claude/Codex MoltNet policy replay', () => {
  it.each(['claude', 'codex'] as const)(
    'applies one resolved policy to %s shell and MCP payloads',
    async (provider) => {
      const fixture = await loadPolicyReplayFixture(fixturePath);
      const policy = fixture.allowedToolsResponse;
      expect(policy).toMatchObject({
        runtimeKind: 'gondolin_pi',
        runtimeProfileRevision: 1,
      });
      const shellPayload = await loadRetainedPreToolUse(
        join(fixtureDir, fixture.retainedPayloads[provider].shell),
        'Bash',
      );
      const mcpPayload = await loadRetainedPreToolUse(
        join(fixtureDir, fixture.retainedPayloads[provider].mcp),
        'mcp__probe__probe_echo',
      );

      const cases: Array<{
        payload: ReplayPayload;
        decision: 'allow' | 'deny';
        reasonCode: string;
      }> = [
        {
          payload: { ...shellPayload, tool_input: { command: 'git status' } },
          decision: 'allow',
          reasonCode: 'shell_command_prefix_allowed',
        },
        {
          payload: { ...shellPayload, tool_input: { command: 'git push' } },
          decision: 'deny',
          reasonCode: 'tool_not_permitted',
        },
        {
          payload: {
            ...mcpPayload,
            tool_name: 'mcp__probe__probe_echo',
          },
          decision: 'allow',
          reasonCode: 'policy_allowed',
        },
        {
          payload: {
            ...mcpPayload,
            tool_name: 'mcp__probe__probe_sibling',
          },
          decision: 'deny',
          reasonCode: 'tool_not_permitted',
        },
      ];

      const actualEvidence = [];

      for (const expected of cases) {
        const evidence = await replayPreToolUse(
          provider,
          expected.payload,
          policy,
        );
        expect(evidence).toMatchObject({
          runtimeProfileRevision: policy.runtimeProfileRevision,
          policySnapshotHash: policy.policySnapshotHash,
          provider,
          nativeActionIdentifier: expected.payload.tool_use_id,
          decision: expected.decision,
          reasonCode: expected.reasonCode,
          decisionLocus: 'offline-replay',
          intendedEnforcementLocus: 'PreToolUse',
          enforcementObserved: false,
        });
        expectAcceptedProviderResponse(
          provider,
          evidence.hookResponse,
          expected.decision,
        );
        actualEvidence.push(evidence);
      }

      const expectedEvidence = JSON.parse(
        await readFile(join(fixtureDir, 'policy-replay.expected.json'), 'utf8'),
      ) as Record<typeof provider, typeof actualEvidence>;
      expect(actualEvidence).toEqual(expectedEvidence[provider]);
    },
  );

  it('does not call the probe-local launch callback without a policy', async () => {
    const launch = vi.fn();

    await expect(
      launchAfterPolicyResolution(async () => undefined, launch),
    ).rejects.toThrow('runtime policy resolution unavailable');
    expect(launch).not.toHaveBeenCalled();
  });

  it('does not treat apply_patch command input as Bash', async () => {
    const fixture = await loadPolicyReplayFixture(fixturePath);
    const shellPayload = await loadRetainedPreToolUse(
      join(fixtureDir, fixture.retainedPayloads.codex.shell),
      'Bash',
    );

    const evidence = await replayPreToolUse(
      'codex',
      {
        ...shellPayload,
        tool_name: 'apply_patch',
        tool_input: { command: 'git status' },
      },
      fixture.allowedToolsResponse,
    );

    expect(evidence).toMatchObject({
      decision: 'deny',
      reasonCode: 'tool_not_permitted',
    });
  });

  it.each(['claude', 'codex'] as const)(
    'spawns the actual %s hook command and emits contract-valid stdout',
    async (provider) => {
      const fixture = await loadPolicyReplayFixture(fixturePath);
      const shellPayload = await loadRetainedPreToolUse(
        join(fixtureDir, fixture.retainedPayloads[provider].shell),
        'Bash',
      );
      const mcpPayload = await loadRetainedPreToolUse(
        join(fixtureDir, fixture.retainedPayloads[provider].mcp),
        'mcp__probe__probe_echo',
      );

      const cases: Array<{
        decision: 'allow' | 'deny';
        payload: ReplayPayload;
      }> = [
        { decision: 'allow', payload: mcpPayload },
        { decision: 'deny', payload: shellPayload },
      ];

      for (const expected of cases) {
        const result = await spawnPolicyHook(provider, expected.payload);
        expect(result.stderr).toBe('');
        const response = JSON.parse(
          result.stdout,
        ) as ProviderPreToolUseResponse;
        expectAcceptedProviderResponse(provider, response, expected.decision);
        expect(result.evidence).toMatchObject({
          provider,
          nativeActionIdentifier: expected.payload.tool_use_id,
          decision: expected.decision,
          decisionLocus: 'offline-replay',
          intendedEnforcementLocus: 'PreToolUse',
          enforcementObserved: false,
        });
      }
    },
  );
});
