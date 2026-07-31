import { describe, expect, it } from 'vitest';

import {
  AGENT_CREDENTIAL_SCOPES,
  AGENT_OAUTH_SCOPES,
  ALL_CREDENTIAL_SCOPES,
  CREDENTIAL_SCOPES,
  credentialScopeSetsEqual,
  HUMAN_SESSION_SCOPES,
  MCP_CLIENT_SCOPES,
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
      'team:manage',
      'team:read',
    ]);
    expect(MCP_CLIENT_SCOPES).not.toContain('key:manage');
    expect(MCP_CLIENT_SCOPES).not.toContain('runtime:manage');
    expect(MCP_CLIENT_SCOPES).not.toContain('task:claim');
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
