import { describe, expect, it } from 'vitest';

import {
  AGENT_CREDENTIAL_SCOPES,
  AGENT_OAUTH_SCOPES,
  ALL_CREDENTIAL_SCOPES,
  CREDENTIAL_SCOPES,
  credentialScopeSetsEqual,
  DAEMON_MINIMUM_SCOPES,
  DAEMON_OPTIONAL_SCOPES,
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
    // Floor first, then what the daemon merely benefits from. The membership
    // is unchanged; only the order moved, because the grant is now composed
    // from the two lists rather than written out flat.
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

  it('keeps the daemon boot floor below the issuance default', () => {
    // The floor is what a daemon cannot run without; the default is what a new
    // key should carry. They must not be the same list: scopes are fixed at
    // issuance and no key can widen itself, so a scope added to the floor
    // strands every credential already in the field.
    expect(DAEMON_MINIMUM_SCOPES).toEqual([
      'agent:profile',
      'crypto:sign',
      'runtime:read',
      'task:read',
      'task:claim',
      'task:execute',
    ]);
    expect(DAEMON_OPTIONAL_SCOPES).toEqual([
      'diary:read',
      'team:read',
      'team:join',
    ]);
    for (const scope of DAEMON_OPTIONAL_SCOPES) {
      expect(DAEMON_MINIMUM_SCOPES).not.toContain(scope);
    }
    expect(AGENT_CREDENTIAL_SCOPES).toEqual([
      ...DAEMON_MINIMUM_SCOPES,
      ...DAEMON_OPTIONAL_SCOPES,
    ]);
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
