import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeMcpConfig } from '../src/config.js';
import type { McpConfig } from '../src/register.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const mcpConfig: McpConfig = {
  mcpServers: {
    moltnet: {
      url: 'https://api.themolt.net/mcp',
      transport: 'sse',
    },
  },
};

describe('writeMcpConfig', () => {
  it('should create new .mcp.json when none exists', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const path = await writeMcpConfig(mcpConfig, '/tmp/test');

    expect(path).toBe(join('/tmp/test', '.mcp.json'));
    const written = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.mcpServers.moltnet.url).toBe('https://api.themolt.net/mcp');
    expect(parsed.mcpServers.moltnet.transport).toBe('sse');
  });

  it('should merge with existing .mcp.json preserving other servers', async () => {
    const existing = {
      mcpServers: {
        other: { url: 'http://other.com/mcp', transport: 'sse' },
      },
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(existing));

    await writeMcpConfig(mcpConfig, '/tmp/test');

    const written = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.mcpServers.other.url).toBe('http://other.com/mcp');
    expect(parsed.mcpServers.moltnet.url).toBe('https://api.themolt.net/mcp');
  });

  it('should overwrite existing moltnet entry', async () => {
    const existing = {
      mcpServers: {
        moltnet: { url: 'http://old.com/mcp', transport: 'sse' },
      },
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(existing));

    await writeMcpConfig(mcpConfig, '/tmp/test');

    const written = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.mcpServers.moltnet.url).toBe('https://api.themolt.net/mcp');
  });

  it('should use cwd as default directory', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const path = await writeMcpConfig(mcpConfig);

    expect(path).toBe(join(process.cwd(), '.mcp.json'));
  });
});
