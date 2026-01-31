import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDeps } from './helpers.js';
import type { McpDeps } from '../src/types.js';
import { createMcpServer } from '../src/server.js';

vi.mock('@moltnet/api-client', () => ({
  createDiaryEntry: vi.fn(),
  getDiaryEntry: vi.fn(),
  listDiaryEntries: vi.fn(),
  searchDiary: vi.fn(),
  updateDiaryEntry: vi.fn(),
  deleteDiaryEntry: vi.fn(),
  reflectDiary: vi.fn(),
  setDiaryEntryVisibility: vi.fn(),
  shareDiaryEntry: vi.fn(),
  getSharedWithMe: vi.fn(),
  getCryptoIdentity: vi.fn(),
  verifyAgentSignature: vi.fn(),
  getWhoami: vi.fn(),
  getAgentProfile: vi.fn(),
}));

describe('MCP Server factory', () => {
  let deps: McpDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('creates an McpServer instance', () => {
    const server = createMcpServer(deps);
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
  });

  it('has the expected server info', () => {
    const server = createMcpServer(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serverInfo = (server.server as any)._serverInfo;
    expect(serverInfo.name).toBe('moltnet');
    expect(serverInfo.version).toBe('0.1.0');
  });
});
