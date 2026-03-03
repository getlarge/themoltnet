import { describe, expect, it } from 'vitest';

import { resolveAgentName, resolveCredentialsPath } from './github-token.js';

describe('resolveAgentName', () => {
  it('uses --name flag when provided', () => {
    expect(resolveAgentName('mybot', undefined)).toBe('mybot');
  });

  it('extracts name from GIT_CONFIG_GLOBAL', () => {
    expect(resolveAgentName(undefined, '.moltnet/legreffier/gitconfig')).toBe(
      'legreffier',
    );
  });

  it('extracts name from absolute GIT_CONFIG_GLOBAL', () => {
    expect(
      resolveAgentName(
        undefined,
        '/Users/dev/repo/.moltnet/my-agent/gitconfig',
      ),
    ).toBe('my-agent');
  });

  it('throws when neither flag nor env is available', () => {
    expect(() => resolveAgentName(undefined, undefined)).toThrow(
      'agent name required',
    );
  });

  it('throws when GIT_CONFIG_GLOBAL does not match moltnet pattern', () => {
    expect(() => resolveAgentName(undefined, '/etc/gitconfig')).toThrow(
      'agent name required',
    );
  });
});

describe('resolveCredentialsPath', () => {
  it('builds path from agent name and dir', () => {
    expect(resolveCredentialsPath('legreffier', '/repo')).toBe(
      '/repo/.moltnet/legreffier/moltnet.json',
    );
  });
});
