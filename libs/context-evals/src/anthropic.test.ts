import { describe, expect, it } from 'vitest';

import type { ClaudeQueryOptions } from './anthropic.js';

describe('ClaudeQueryOptions', () => {
  it('accepts mcpServers option', () => {
    const opts: ClaudeQueryOptions = {
      cwd: '/tmp/test',
      prompt: 'test',
      maxTurns: 5,
      clientApp: 'test',
      mcpServers: {
        legreffier: {
          type: 'http',
          url: 'http://localhost:8001/mcp',
          headers: { 'X-Client-Id': 'abc' },
        },
      },
    };
    expect(opts.mcpServers).toBeDefined();
    expect(opts.mcpServers!['legreffier']).toHaveProperty('type', 'http');
  });

  it('accepts extraEnv option', () => {
    const opts: ClaudeQueryOptions = {
      cwd: '/tmp/test',
      prompt: 'test',
      maxTurns: 5,
      clientApp: 'test',
      extraEnv: { GIT_CONFIG_GLOBAL: '/tmp/.moltnet/eval-agent/gitconfig' },
    };
    expect(opts.extraEnv).toBeDefined();
  });
});
