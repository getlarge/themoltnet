import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockServices,
  createMockDeps,
  type MockServices,
} from './helpers.js';
import type { McpDeps } from '../src/types.js';
import { createMcpServer } from '../src/server.js';

describe('MCP Server factory', () => {
  let mocks: MockServices;
  let deps: McpDeps;

  beforeEach(() => {
    mocks = createMockServices();
    deps = createMockDeps(mocks);
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
