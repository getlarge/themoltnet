/**
 * E2E: Task MCP App
 *
 * These tests cover the MCP Apps contract at the protocol boundary:
 * the opener tool advertises a UI resource, the tool result keeps a usable
 * text/structured fallback, and the app HTML resource can be read by hosts.
 *
 * Browser behavior belongs in a host-driven Playwright suite against the
 * ext-apps basic-host reference host; this suite stays host-independent.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMcpTestClient, parseToolResult } from './mcp-client.js';
import { createMcpTestHarness, type McpTestHarness } from './setup.js';

const TASK_APP_RESOURCE_URI = 'ui://moltnet/tasks.html';
const TASK_APP_MIME_TYPE = 'text/html;profile=mcp-app';

describe('Task MCP App E2E', () => {
  let harness: McpTestHarness;
  let client: Client;
  let setupError: Error | undefined;

  beforeAll(async () => {
    harness = await createMcpTestHarness();

    try {
      client = await connectMcpTestClient(harness, 'e2e-task-app-client');
    } catch (err) {
      setupError = err instanceof Error ? err : new Error(String(err));
    }
  });

  afterAll(async () => {
    try {
      await client?.close();
    } finally {
      await harness?.teardown();
    }
  });

  function requireSetup(): void {
    if (setupError) {
      throw new Error(
        `MCP client setup failed — skipping is not allowed: ${setupError.message}`,
      );
    }
  }

  it('advertises the task app opener tool with UI metadata', async () => {
    requireSetup();

    const { tools } = await client.listTools();
    const appTool = tools.find((tool) => tool.name === 'tasks_app_open');

    expect(appTool).toBeDefined();
    expect(appTool?._meta).toMatchObject({
      ui: {
        resourceUri: TASK_APP_RESOURCE_URI,
        visibility: ['model', 'app'],
      },
    });
    expect(appTool?.inputSchema).toMatchObject({
      type: 'object',
      properties: expect.objectContaining({
        team_id: expect.any(Object),
        task_id: expect.any(Object),
        status: expect.any(Object),
      }),
    });
  });

  it('returns structured and text fallback data for non-UI hosts', async () => {
    requireSetup();

    const result = await client.callTool({
      name: 'tasks_app_open',
      arguments: {
        team_id: harness.personalTeamId,
        status: 'queued',
      },
    });
    const opened = parseToolResult<{
      app: string;
      resourceUri: string;
      teamId: string;
      status: string;
      tools: string[];
    }>(result);

    expect(
      result.isError,
      `tasks_app_open error: ${opened.content[0].text}`,
    ).toBeUndefined();
    expect(opened.parsed).toMatchObject({
      app: 'moltnet_tasks',
      resourceUri: TASK_APP_RESOURCE_URI,
      teamId: harness.personalTeamId,
      status: 'queued',
    });
    expect(opened.parsed.tools).toEqual(
      expect.arrayContaining([
        'tasks_list',
        'tasks_get',
        'tasks_attempts_list',
        'tasks_messages_list',
      ]),
    );
    expect(result.structuredContent).toMatchObject(opened.parsed);
  });

  it('serves the MCP App HTML resource with CSP metadata', async () => {
    requireSetup();

    const result = await client.readResource({
      uri: TASK_APP_RESOURCE_URI,
    });
    expect(result.contents).toHaveLength(1);

    const resource = result.contents[0] as {
      uri: string;
      mimeType?: string;
      text?: string;
      _meta?: Record<string, unknown>;
    };
    expect(resource.uri).toBe(TASK_APP_RESOURCE_URI);
    expect(resource.mimeType).toBe(TASK_APP_MIME_TYPE);
    expect(resource.text).toContain('MoltNet Tasks');
    expect(resource.text).toContain('@modelcontextprotocol/ext-apps@1.6.0');
    expect(resource.text).toContain("name: 'tasks_list'");
    expect(resource.text).toContain("name: 'tasks_get'");
    expect(resource._meta).toMatchObject({
      ui: {
        csp: {
          connectDomains: ['https://esm.sh'],
          resourceDomains: ['https://esm.sh'],
        },
        prefersBorder: false,
      },
    });
  });
});
