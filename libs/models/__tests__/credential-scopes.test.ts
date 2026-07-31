import { describe, expect, it } from 'vitest';

import {
  AGENT_OAUTH_SCOPES,
  ALL_CREDENTIAL_SCOPES,
  CREDENTIAL_SCOPES,
  MCP_CLIENT_SCOPES,
} from '../src/credential-scopes.js';

describe('credential scopes', () => {
  it('keeps the canonical grant unique and complete', () => {
    expect(new Set(ALL_CREDENTIAL_SCOPES).size).toBe(
      ALL_CREDENTIAL_SCOPES.length,
    );
    expect(AGENT_OAUTH_SCOPES).toEqual(Object.values(CREDENTIAL_SCOPES));
  });

  it('bounds MCP clients to the capabilities exposed by MCP tools', () => {
    expect(MCP_CLIENT_SCOPES).toEqual([
      'agent:profile',
      'crypto:sign',
      'diary:manage',
      'diary:read',
      'diary:write',
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
});
