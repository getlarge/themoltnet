import { describe, expect, it } from 'vitest';

import {
  handleTasksAppOpen,
  handleTasksAppResource,
  TASK_APP_MIME_TYPE,
  TASK_APP_RESOURCE_URI,
} from '../src/task-app.js';
import { parseResult } from './helpers.js';

const TASK_ID = '110e8400-e29b-41d4-a716-446655440091';
const TEAM_ID = '220e8400-e29b-41d4-a716-446655440091';

describe('Task MCP App', () => {
  it('opens with structured fallback data and a console handoff URL', () => {
    const result = handleTasksAppOpen(
      {
        team_id: TEAM_ID,
        task_id: TASK_ID,
        status: 'queued',
      },
      { consoleBaseUrl: 'https://console.example.com////' },
    );

    const parsed = parseResult<{
      app: string;
      resourceUri: string;
      teamId: string;
      taskId: string;
      status: string;
      consoleUrl: string;
      tools: string[];
    }>(result);

    expect(parsed).toMatchObject({
      app: 'moltnet_tasks',
      resourceUri: TASK_APP_RESOURCE_URI,
      teamId: TEAM_ID,
      taskId: TASK_ID,
      status: 'queued',
      consoleUrl: `https://console.example.com/tasks/${TASK_ID}`,
    });
    expect(parsed.tools).toEqual(
      expect.arrayContaining([
        'tasks_list',
        'tasks_get',
        'tasks_attempts_list',
        'tasks_messages_list',
      ]),
    );
    expect(result.structuredContent).toMatchObject(parsed);
  });

  it('serves an MCP App HTML resource with CSP metadata', () => {
    const result = handleTasksAppResource();
    const content = result.contents[0] as {
      uri: string;
      mimeType: string;
      text: string;
      _meta?: Record<string, unknown>;
    };

    expect(content.uri).toBe(TASK_APP_RESOURCE_URI);
    expect(content.mimeType).toBe(TASK_APP_MIME_TYPE);
    expect(content.text).toContain('@modelcontextprotocol/ext-apps@1.6.0');
    expect(content.text).toContain("name: 'tasks_list'");
    expect(content._meta).toMatchObject({
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
