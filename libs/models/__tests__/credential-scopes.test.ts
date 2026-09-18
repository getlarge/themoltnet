import { describe, expect, it } from 'vitest';

import {
  AGENT_CREDENTIAL_SCOPES,
  AGENT_OAUTH_SCOPES,
  ALL_CREDENTIAL_SCOPES,
  CREDENTIAL_SCOPES,
  credentialScopeSetsEqual,
  DAEMON_MINIMUM_SCOPES,
  HUMAN_SESSION_SCOPES,
  MCP_CLIENT_SCOPES,
  MCP_M2M_SCOPES,
  READ_ONLY_CREDENTIAL_SCOPES,
  TASK_WORKFLOW_CREDENTIAL_SCOPES,
} from '../src/credential-scopes.js';

describe('credential scopes', () => {
  it('keeps the canonical grant unique and complete', () => {
    expect(new Set(ALL_CREDENTIAL_SCOPES).size).toBe(
      ALL_CREDENTIAL_SCOPES.length,
    );
    expect(HUMAN_SESSION_SCOPES).toEqual(Object.values(CREDENTIAL_SCOPES));
  });

  it('keeps human profile out of direct agent and M2M credentials', () => {
    expect(AGENT_CREDENTIAL_SCOPES).not.toContain('human:profile');
    expect(AGENT_OAUTH_SCOPES).toEqual(
      ALL_CREDENTIAL_SCOPES.filter((scope) => scope !== 'human:profile'),
    );
  });

  it('bounds MCP clients to the capabilities exposed by MCP tools', () => {
    expect(MCP_CLIENT_SCOPES).toEqual([
      'agent:profile',
      'crypto:sign',
      'diary:manage',
      'diary:read',
      'diary:write',
      'human:profile',
      'pack:read',
      'pack:write',
      'task:execute',
      'task:manage',
      'task:read',
      'task:write',
      'team:join',
      'team:manage',
      'team:read',
    ]);
    expect(MCP_CLIENT_SCOPES).not.toContain('key:manage');
    expect(MCP_CLIENT_SCOPES).not.toContain('runtime:manage');
    expect(MCP_CLIENT_SCOPES).not.toContain('task:claim');
    expect(MCP_M2M_SCOPES).toEqual(
      MCP_CLIENT_SCOPES.filter((scope) => scope !== 'human:profile'),
    );
  });

  it('exports exact job-oriented credential presets', () => {
    expect(AGENT_CREDENTIAL_SCOPES).toEqual([
      'agent:profile',
      'crypto:sign',
      'runtime:read',
      'task:read',
      'task:claim',
      'task:execute',
      'diary:read',
      'team:read',
      'team:join',
    ]);
    expect(AGENT_CREDENTIAL_SCOPES).not.toContain('key:manage');
    expect(AGENT_CREDENTIAL_SCOPES).not.toContain('team:manage');
    expect(TASK_WORKFLOW_CREDENTIAL_SCOPES).toEqual([
      'agent:profile',
      'task:read',
      'task:write',
    ]);
    expect(READ_ONLY_CREDENTIAL_SCOPES).toEqual([
      'agent:profile',
      'diary:read',
      'pack:read',
      'runtime:read',
      'task:read',
      'team:read',
    ]);
  });

  it('issues agent keys able to read the teams and diaries they are bound to', () => {
    // The desktop catalogue calls `teams.list` and `diaries.list` with the
    // agent's own credential. Without these the composer cannot name the team
    // a run belongs to, or pair it with a diary.
    expect(AGENT_CREDENTIAL_SCOPES).toContain('team:read');
    expect(AGENT_CREDENTIAL_SCOPES).toContain('diary:read');
  });

  it('keeps the daemon boot floor below the issuance default', () => {
    // Scopes are fixed when a key is minted, so every key issued before this
    // widening lacks the two new ones. If the boot floor moved with the
    // default, each of those keys would stop a running daemon dead. The floor
    // is what the daemon cannot work without; the default is what a new key
    // should carry.
    expect(DAEMON_MINIMUM_SCOPES).toEqual([
      'agent:profile',
      'crypto:sign',
      'runtime:read',
      'task:read',
      'task:claim',
      'task:execute',
    ]);
    expect(DAEMON_MINIMUM_SCOPES).not.toContain('team:read');
    expect(DAEMON_MINIMUM_SCOPES).not.toContain('diary:read');
    for (const scope of DAEMON_MINIMUM_SCOPES) {
      expect(AGENT_CREDENTIAL_SCOPES).toContain(scope);
    }
  });

  it('compares scopes as exact duplicate-free sets', () => {
    expect(
      credentialScopeSetsEqual(
        ['task:read', 'diary:read'],
        ['diary:read', 'task:read'],
      ),
    ).toBe(true);
    expect(
      credentialScopeSetsEqual(
        ['task:read', 'task:read'],
        ['task:read', 'diary:read'],
      ),
    ).toBe(false);
    expect(credentialScopeSetsEqual([' task:read'], ['task:read'])).toBe(false);
    expect(credentialScopeSetsEqual(undefined, ['task:read'])).toBe(false);
  });
});
