/**
 * @moltnet/mcp-server — MCP Apps task surface
 *
 * The MCP App is intentionally a host wrapper around the existing task tools.
 * It receives the opener tool result from the host, then calls tasks_list,
 * tasks_get, tasks_attempts_list, and tasks_messages_list through the MCP Apps
 * bridge. The iframe never receives a bearer token or talks to REST directly.
 */

import type { FastifyInstance } from 'fastify';

import type {
  TaskAppOpenInput,
  TaskAppOpenOutput,
} from './schemas/task-schemas.js';
import {
  TaskAppOpenOutputSchema,
  TaskAppOpenSchema,
} from './schemas/task-schemas.js';
import type { CallToolResult, McpDeps, ReadResourceResult } from './types.js';
import { structuredResult } from './utils.js';

export const TASK_APP_RESOURCE_URI = 'ui://moltnet/tasks.html';
export const TASK_APP_MIME_TYPE = 'text/html;profile=mcp-app';

const TASK_APP_RESOURCE_META = {
  ui: {
    csp: {
      connectDomains: ['https://esm.sh'],
      resourceDomains: ['https://esm.sh'],
      frameDomains: [],
    },
    prefersBorder: false,
  },
};

function buildTaskAppHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MoltNet Tasks</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        background: Canvas;
        color: CanvasText;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-width: 320px;
      }
      main {
        display: grid;
        gap: 12px;
        padding: 12px;
      }
      header,
      section,
      form {
        border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
        border-radius: 8px;
        padding: 12px;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      h1,
      h2 {
        margin: 0;
        line-height: 1.2;
      }
      h1 {
        font-size: 18px;
      }
      h2 {
        font-size: 14px;
      }
      .muted {
        color: color-mix(in srgb, CanvasText 62%, transparent);
        font-size: 12px;
      }
      .grid {
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(0, 1fr);
      }
      @media (min-width: 840px) {
        .grid {
          grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
        }
      }
      label {
        display: grid;
        gap: 4px;
        font-size: 12px;
      }
      input,
      select,
      button {
        min-height: 34px;
        border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
        border-radius: 6px;
        background: Canvas;
        color: CanvasText;
        font: inherit;
      }
      input,
      select {
        padding: 6px 8px;
        min-width: 0;
      }
      button {
        padding: 6px 10px;
        cursor: pointer;
      }
      button.primary {
        background: LinkText;
        border-color: LinkText;
        color: Canvas;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .fields {
        display: grid;
        gap: 8px;
        grid-template-columns: minmax(0, 1fr);
      }
      @media (min-width: 640px) {
        .fields {
          grid-template-columns: minmax(0, 1fr) minmax(120px, 160px);
        }
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
        padding: 10px 0;
      }
      .row:first-child {
        border-top: 0;
      }
      .stack {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      code,
      pre {
        overflow-wrap: anywhere;
      }
      pre {
        max-height: 280px;
        overflow: auto;
        border-radius: 6px;
        background: color-mix(in srgb, CanvasText 6%, transparent);
        padding: 10px;
      }
      .status {
        border-radius: 999px;
        padding: 2px 8px;
        background: color-mix(in srgb, LinkText 14%, transparent);
        white-space: nowrap;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="stack">
          <h1>MoltNet Tasks</h1>
          <div id="connection" class="muted">Connecting to host...</div>
        </div>
        <button id="open-console" hidden>Open console</button>
      </header>

      <form id="filters">
        <div class="fields">
          <label>
            Team ID
            <input id="team-id" autocomplete="off" placeholder="team uuid" />
          </label>
          <label>
            Status
            <select id="status">
              <option value="">Any</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
          </label>
        </div>
        <div style="margin-top: 8px">
          <button class="primary" type="submit">Refresh tasks</button>
        </div>
      </form>

      <div class="grid">
        <section>
          <div class="row">
            <h2>Queue</h2>
            <span id="queue-count" class="muted">No data</span>
          </div>
          <div id="queue"></div>
        </section>
        <section>
          <div class="row">
            <h2>Selected task</h2>
            <span id="selected-status" class="status" hidden></span>
          </div>
          <div id="task-detail" class="muted">Select a task to inspect it.</div>
        </section>
      </div>

      <section>
        <h2>Attempts and messages</h2>
        <div id="attempts" class="muted">No task selected.</div>
      </section>
    </main>

    <script type="module">
      import { App } from 'https://esm.sh/@modelcontextprotocol/ext-apps@1.6.0';

      const app = new App({ name: 'MoltNet Tasks', version: '0.1.0' });
      const state = {
        teamId: '',
        taskId: '',
        status: '',
        consoleUrl: '',
        tasks: [],
      };

      const byId = (id) => document.getElementById(id);
      const connection = byId('connection');
      const teamIdInput = byId('team-id');
      const statusInput = byId('status');
      const queue = byId('queue');
      const queueCount = byId('queue-count');
      const selectedStatus = byId('selected-status');
      const taskDetail = byId('task-detail');
      const attempts = byId('attempts');
      const openConsole = byId('open-console');

      function parseToolJson(result) {
        const text = result?.content?.find((item) => item.type === 'text')?.text;
        if (!text) return result?.structuredContent ?? {};
        try {
          return JSON.parse(text);
        } catch {
          return result?.structuredContent ?? {};
        }
      }

      function pretty(value) {
        return JSON.stringify(value ?? null, null, 2);
      }

      function escapeHtml(value) {
        return String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function renderQueue() {
        queueCount.textContent = state.tasks.length
          ? state.tasks.length + ' task' + (state.tasks.length === 1 ? '' : 's')
          : 'No tasks';
        queue.innerHTML = '';
        for (const task of state.tasks) {
          const row = document.createElement('div');
          row.className = 'row';
          row.innerHTML =
            '<div class="stack"><strong>' +
            escapeHtml(task.taskType) +
            '</strong><code class="muted">' +
            escapeHtml(task.id) +
            '</code><span class="muted">' +
            escapeHtml(task.diaryId ?? 'no diary') +
            '</span></div><button type="button">Inspect</button>';
          row.querySelector('button').addEventListener('click', () => {
            void loadTask(task.id);
          });
          queue.append(row);
        }
      }

      function renderTask(task) {
        if (!task?.id) {
          selectedStatus.hidden = true;
          taskDetail.className = 'muted';
          taskDetail.textContent = 'Select a task to inspect it.';
          openConsole.hidden = true;
          return;
        }
        state.taskId = task.id;
        state.consoleUrl = task.consoleUrl ?? '';
        selectedStatus.hidden = false;
        selectedStatus.textContent = task.status ?? 'unknown';
        taskDetail.className = '';
        taskDetail.innerHTML =
          '<div class="stack"><strong>' +
          escapeHtml(task.taskType) +
          '</strong><code>' +
          escapeHtml(task.id) +
          '</code><span class="muted">Queued ' +
          escapeHtml(task.queuedAt ?? 'unknown') +
          '</span></div><pre>' +
          escapeHtml(pretty(task.input)) +
          '</pre>';
        openConsole.hidden = !state.consoleUrl;
      }

      function renderAttempts(items) {
        if (!items?.length) {
          attempts.className = 'muted';
          attempts.textContent = 'No attempts recorded.';
          return;
        }
        attempts.className = '';
        attempts.innerHTML = '';
        for (const attempt of items) {
          const row = document.createElement('div');
          row.className = 'row';
          row.innerHTML =
            '<div class="stack"><strong>Attempt ' +
            escapeHtml(attempt.attemptN) +
            '</strong><span class="muted">' +
            escapeHtml(attempt.status) +
            '</span></div><button type="button">Load messages</button>';
          row.querySelector('button').addEventListener('click', () => {
            void loadMessages(state.taskId, attempt.attemptN, row);
          });
          attempts.append(row);
        }
      }

      async function loadTasks() {
        if (!state.teamId) {
          queue.innerHTML = '<div class="muted">Enter a team ID first.</div>';
          return;
        }
        queue.innerHTML = '<div class="muted">Loading tasks...</div>';
        const result = await app.callServerTool({
          name: 'tasks_list',
          arguments: {
            team_id: state.teamId,
            status: state.status || undefined,
            limit: 25,
          },
        });
        const data = parseToolJson(result);
        state.tasks = data.items ?? [];
        renderQueue();
      }

      async function loadTask(taskId) {
        taskDetail.className = 'muted';
        taskDetail.textContent = 'Loading task...';
        const result = await app.callServerTool({
          name: 'tasks_get',
          arguments: { id: taskId },
        });
        const task = parseToolJson(result);
        renderTask(task);
        await loadAttempts(taskId);
      }

      async function loadAttempts(taskId) {
        attempts.className = 'muted';
        attempts.textContent = 'Loading attempts...';
        const result = await app.callServerTool({
          name: 'tasks_attempts_list',
          arguments: { task_id: taskId },
        });
        renderAttempts(parseToolJson(result).items ?? []);
      }

      async function loadMessages(taskId, attemptN, row) {
        const result = await app.callServerTool({
          name: 'tasks_messages_list',
          arguments: { task_id: taskId, attempt_n: attemptN, limit: 50 },
        });
        const messages = document.createElement('pre');
        messages.textContent = pretty(parseToolJson(result).items ?? []);
        row.after(messages);
      }

      app.ontoolresult = (result) => {
        const data = parseToolJson(result);
        state.teamId = data.teamId ?? '';
        state.taskId = data.taskId ?? '';
        state.status = data.status ?? '';
        state.consoleUrl = data.consoleUrl ?? '';
        teamIdInput.value = state.teamId;
        statusInput.value = state.status;
        connection.textContent = 'Connected';
        if (state.taskId) {
          void loadTask(state.taskId);
        } else if (state.teamId) {
          void loadTasks();
        }
      };
      app.onerror = (error) => {
        connection.textContent = error.message ?? String(error);
      };

      byId('filters').addEventListener('submit', (event) => {
        event.preventDefault();
        state.teamId = teamIdInput.value.trim();
        state.status = statusInput.value;
        void loadTasks();
      });
      openConsole.addEventListener('click', () => {
        if (state.consoleUrl) app.openUrl(state.consoleUrl);
      });

      app.connect();
    </script>
  </body>
</html>`;
}

function getConsoleUrl(
  deps: Pick<McpDeps, 'consoleBaseUrl'>,
  taskId: string | undefined,
  explicitUrl: string | undefined,
): string | undefined {
  if (explicitUrl) return explicitUrl;
  if (!taskId || !deps.consoleBaseUrl) return undefined;
  return `${deps.consoleBaseUrl.replaceAll(/\/+$/g, '')}/tasks/${taskId}`;
}

export function handleTasksAppOpen(
  args: TaskAppOpenInput,
  deps: Pick<McpDeps, 'consoleBaseUrl'> = {},
): CallToolResult {
  const output: TaskAppOpenOutput = {
    app: 'moltnet_tasks',
    resourceUri: TASK_APP_RESOURCE_URI,
    teamId: args.team_id,
    taskId: args.task_id,
    status: args.status,
    consoleUrl: getConsoleUrl(deps, args.task_id, args.console_url),
    tools: [
      'tasks_list',
      'tasks_get',
      'tasks_attempts_list',
      'tasks_messages_list',
    ],
  };
  return structuredResult(output);
}

export function handleTasksAppResource(): ReadResourceResult {
  return {
    contents: [
      {
        uri: TASK_APP_RESOURCE_URI,
        mimeType: TASK_APP_MIME_TYPE,
        text: buildTaskAppHtml(),
        _meta: TASK_APP_RESOURCE_META,
      },
    ],
  };
}

export function registerTaskApp(
  fastify: FastifyInstance,
  deps: Pick<McpDeps, 'consoleBaseUrl'>,
): void {
  fastify.mcpAddTool(
    {
      name: 'tasks_app_open',
      title: 'Open Tasks App',
      description:
        'Open the interactive MoltNet task management app. Use it when a user wants to inspect task queues, task details, attempts, or messages.',
      inputSchema: TaskAppOpenSchema,
      outputSchema: TaskAppOpenOutputSchema,
      _meta: {
        ui: {
          resourceUri: TASK_APP_RESOURCE_URI,
          visibility: ['model', 'app'],
        },
      },
    },
    (args: TaskAppOpenInput) => handleTasksAppOpen(args, deps),
  );

  fastify.mcpAddResource(
    {
      name: 'tasks-app',
      title: 'MoltNet Tasks',
      uriPattern: TASK_APP_RESOURCE_URI,
      description: 'Interactive MCP App for task queue and attempt inspection.',
      mimeType: TASK_APP_MIME_TYPE,
      _meta: TASK_APP_RESOURCE_META,
    },
    () => handleTasksAppResource(),
  );
}
