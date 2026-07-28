// eslint-disable-next-line @nx/enforce-module-boundaries -- The server e2e harness intentionally reuses the CLI-tagged MCP test client.
export {
  createMcpTestHarness,
  type McpTestHarness,
} from '@moltnet/mcp-test-harness';
