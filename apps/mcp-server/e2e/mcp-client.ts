import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { McpTestHarness } from './setup.js';

export async function connectMcpTestClient(
  harness: McpTestHarness,
  name: string,
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${harness.mcpBaseUrl}/mcp`),
    {
      requestInit: {
        headers: {
          'X-Client-Id': harness.agent.clientId,
          'X-Client-Secret': harness.agent.clientSecret,
        },
      },
    },
  );
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(transport);
  return client;
}

export function parseToolResult<T>(
  result: Awaited<ReturnType<Client['callTool']>>,
): {
  content: Array<{ type: string; text: string }>;
  parsed: T;
} {
  const content = result.content as Array<{ type: string; text: string }>;
  return {
    content,
    parsed: JSON.parse(content[0]?.text ?? '{}') as T,
  };
}
