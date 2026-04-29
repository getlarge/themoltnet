/**
 * @moltnet/mcp-server — MCP Apps task surface
 *
 * The MCP App is intentionally a host wrapper around the existing task tools.
 * It receives the opener tool result from the host, then calls tasks_list,
 * tasks_get, tasks_attempts_list, and tasks_messages_list through the MCP Apps
 * bridge. The iframe never receives a bearer token or talks to REST directly.
 */

import { colors, fontFamily, radius } from '@themoltnet/design-system/tokens';
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

function buildTaskAppThemeCss(): string {
  return Object.entries({
    '--molt-bg-void': colors.bg.void,
    '--molt-bg-surface': colors.bg.surface,
    '--molt-bg-elevated': colors.bg.elevated,
    '--molt-bg-overlay': colors.bg.overlay,
    '--molt-primary': colors.primary.DEFAULT,
    '--molt-primary-hover': colors.primary.hover,
    '--molt-primary-muted': colors.primary.muted,
    '--molt-primary-subtle': colors.primary.subtle,
    '--molt-accent': colors.accent.DEFAULT,
    '--molt-text': colors.text.DEFAULT,
    '--molt-text-secondary': colors.text.secondary,
    '--molt-text-muted': colors.text.muted,
    '--molt-text-inverse': colors.text.inverse,
    '--molt-border': colors.border.DEFAULT,
    '--molt-border-hover': colors.border.hover,
    '--molt-error': colors.error.DEFAULT,
    '--molt-warning': colors.warning.DEFAULT,
    '--molt-success': colors.success.DEFAULT,
    '--molt-info': colors.info.DEFAULT,
    '--molt-font-sans': fontFamily.sans,
    '--molt-font-mono': fontFamily.mono,
    '--molt-radius-sm': radius.sm,
    '--molt-radius-md': radius.md,
    '--molt-radius-full': radius.full,
  })
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
}

function buildTaskAppHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MoltNet Tasks</title>
    <style>
      :root {
        color-scheme: dark;
        ${buildTaskAppThemeCss()};
        font-family: var(--molt-font-sans);
        background: var(--molt-bg-void);
        color: var(--molt-text);
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-width: 320px;
        background:
          linear-gradient(180deg, var(--molt-primary-subtle), transparent 260px),
          var(--molt-bg-void);
      }
      main {
        display: grid;
        gap: 16px;
        padding: 16px;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border-bottom: 1px solid var(--molt-border);
        padding-bottom: 14px;
      }
      section,
      form,
      .panel {
        border: 1px solid var(--molt-border);
        border-radius: var(--molt-radius-md);
        background: var(--molt-bg-surface);
        padding: 14px;
      }
      h1,
      h2 {
        margin: 0;
        line-height: 1.2;
      }
      h1 {
        font-size: 20px;
      }
      h2 {
        font-size: 14px;
        letter-spacing: 0;
      }
      .muted {
        color: var(--molt-text-secondary);
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
        min-height: 36px;
        border: 1px solid var(--molt-border);
        border-radius: var(--molt-radius-md);
        background: var(--molt-bg-elevated);
        color: var(--molt-text);
        font: inherit;
      }
      input,
      select {
        padding: 6px 8px;
        min-width: 0;
      }
      button {
        padding: 7px 12px;
        cursor: pointer;
      }
      button.primary {
        background: var(--molt-primary);
        border-color: var(--molt-primary);
        color: var(--molt-text-inverse);
        font-weight: 600;
      }
      button:hover:not(:disabled) {
        border-color: var(--molt-border-hover);
      }
      button.primary:hover:not(:disabled) {
        background: var(--molt-primary-hover);
        border-color: var(--molt-primary-hover);
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
          grid-template-columns:
            minmax(0, 1fr) minmax(0, 1fr) minmax(120px, 160px);
        }
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-top: 1px solid var(--molt-border);
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
        border-radius: var(--molt-radius-sm);
        background: var(--molt-bg-overlay);
        padding: 10px;
      }
      .status {
        border-radius: var(--molt-radius-full);
        padding: 2px 8px;
        background: var(--molt-primary-muted);
        color: var(--molt-primary);
        white-space: nowrap;
        font-size: 12px;
        line-height: 1.4;
        text-align: center;
      }
      .queue-status {
        align-self: start;
        min-width: 86px;
      }
      .queue-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        width: 100%;
        border: 0;
        border-top: 1px solid var(--molt-border);
        border-radius: 0;
        background: transparent;
        padding: 12px 0;
        text-align: left;
      }
      .queue-item:first-child {
        border-top: 0;
      }
      .queue-item:hover {
        background: var(--molt-primary-subtle);
      }
      .mono {
        font-family:
          var(--molt-font-mono);
      }
      .facts {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      }
      .fact {
        display: grid;
        gap: 3px;
        min-width: 0;
      }
      .fact strong {
        color: var(--molt-text-secondary);
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
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
            Team
            <select id="team-select">
              <option value="">Select team</option>
            </select>
          </label>
          <label>
            Team ID
            <input id="team-id" autocomplete="off" placeholder="team uuid" />
          </label>
          <label>
            Worked by
            <select id="agent">
              <option value="">Any agent</option>
            </select>
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
          <button id="load-more" type="button" style="margin-top: 8px" hidden>
            Load more
          </button>
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
      function createHostBridge() {
        let nextId = 1;
        const pending = new Map();
        const bridge = {
          ontoolinput: undefined,
          ontoolresult: undefined,
          onerror: undefined,
          async connect() {
            window.addEventListener('message', (event) => {
              const message = event.data;
              if (!message || message.jsonrpc !== '2.0') return;
              if (Object.prototype.hasOwnProperty.call(message, 'id')) {
                const handler = pending.get(message.id);
                if (handler) {
                  pending.delete(message.id);
                  if (message.error) {
                    handler.reject(new Error(message.error.message ?? 'Host request failed'));
                  } else {
                    handler.resolve(message.result);
                  }
                  return;
                }
                window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
                return;
              }
              if (message.method === 'ui/notifications/tool-input') {
                bridge.ontoolinput?.(message.params ?? {});
              } else if (message.method === 'ui/notifications/tool-result') {
                bridge.ontoolresult?.(message.params ?? {});
              }
            });

            await request('ui/initialize', {
              appCapabilities: {},
              appInfo: { name: 'MoltNet Tasks', version: '0.1.0' },
              protocolVersion: '2026-01-26',
            });
            notify('ui/notifications/initialized', {});
            notifySizeChanged();
          },
          callServerTool(params) {
            return request('tools/call', params);
          },
          openLink(params) {
            return request('ui/open-link', params);
          },
        };

        function request(method, params) {
          const id = nextId++;
          const message = { jsonrpc: '2.0', id, method, params };
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            window.parent.postMessage(message, '*');
          });
        }

        function notify(method, params) {
          window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
        }

        function notifySizeChanged() {
          const height = Math.ceil(document.documentElement.scrollHeight);
          const width = Math.ceil(document.documentElement.scrollWidth);
          notify('ui/notifications/size-changed', { height, width });
        }

        const resizeObserver = new ResizeObserver(() => notifySizeChanged());
        resizeObserver.observe(document.documentElement);
        resizeObserver.observe(document.body);

        return bridge;
      }

      const app = createHostBridge();
      const state = {
        teamId: '',
        taskId: '',
        status: '',
        agentId: '',
        consoleUrl: '',
        teams: [],
        members: [],
        tasks: [],
        attemptsByTaskId: new Map(),
        nextCursor: undefined,
      };

      const byId = (id) => document.getElementById(id);
      const connection = byId('connection');
      const teamSelect = byId('team-select');
      const teamIdInput = byId('team-id');
      const agentInput = byId('agent');
      const statusInput = byId('status');
      const queue = byId('queue');
      const queueCount = byId('queue-count');
      const loadMore = byId('load-more');
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

      function getTeamLabel(team) {
        const suffix = team.personal ? ' personal' : team.role ? ' ' + team.role : '';
        return (team.name ?? team.id) + suffix;
      }

      function getMemberLabel(member) {
        const name = member.displayName || member.subjectId;
        const fingerprint = member.fingerprint ? ' ' + member.fingerprint.slice(0, 12) : '';
        return name + fingerprint;
      }

      function getTaskAttempts(taskId) {
        return state.attemptsByTaskId.get(taskId) ?? [];
      }

      function getTaskWorkerIds(taskId) {
        return [...new Set(getTaskAttempts(taskId).map((attempt) => attempt.claimedByAgentId).filter(Boolean))];
      }

      function getWorkerTaskCounts() {
        const counts = new Map();
        for (const task of state.tasks) {
          for (const agentId of getTaskWorkerIds(task.id)) {
            counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
          }
        }
        return counts;
      }

      function getVisibleTasks() {
        if (!state.agentId) return state.tasks;
        return state.tasks.filter((task) =>
          getTaskWorkerIds(task.id).includes(state.agentId),
        );
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
        const visibleTasks = getVisibleTasks();
        queueCount.textContent = visibleTasks.length
          ? visibleTasks.length + ' task' + (visibleTasks.length === 1 ? '' : 's')
          : 'No tasks';
        loadMore.hidden = !state.nextCursor;
        queue.innerHTML = '';
        for (const task of visibleTasks) {
          const workers = getTaskWorkerIds(task.id);
          const workerText = workers.length
            ? 'Worked by ' + workers.map((id) => getMemberLabel(state.members.find((member) => member.subjectId === id) ?? { subjectId: id })).join(', ')
            : task.imposedByAgentId
              ? 'Requested by ' + task.imposedByAgentId
              : 'No attempts yet';
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'queue-item';
          row.innerHTML =
            '<div class="stack"><strong>' +
            escapeHtml(task.taskType) +
            '</strong><code class="muted mono">' +
            escapeHtml(task.id) +
            '</code><span class="muted">' +
            escapeHtml(workerText) +
            '</span></div><span class="status queue-status">' +
            escapeHtml(task.status ?? 'unknown') +
            '</span>';
          row.addEventListener('click', () => {
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
          '</strong><code class="mono">' +
          escapeHtml(task.id) +
          '</code></div><div class="facts" style="margin-top: 12px">' +
          '<div class="fact"><strong>Team</strong><span class="mono">' +
          escapeHtml(task.teamId ?? '—') +
          '</span></div><div class="fact"><strong>Diary</strong><span class="mono">' +
          escapeHtml(task.diaryId ?? '—') +
          '</span></div><div class="fact"><strong>Queued</strong><span>' +
          escapeHtml(task.queuedAt ?? 'unknown') +
          '</span></div><div class="fact"><strong>Requester</strong><span class="mono">' +
          escapeHtml(task.imposedByAgentId ?? task.imposedByHumanId ?? '—') +
          '</span></div><div class="fact"><strong>Accepted</strong><span>' +
          escapeHtml(task.acceptedAttemptN ?? '—') +
          '</span></div></div><pre>' +
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
            ' by ' +
            escapeHtml(
              getMemberLabel(
                state.members.find(
                  (member) => member.subjectId === attempt.claimedByAgentId,
                ) ?? { subjectId: attempt.claimedByAgentId },
              ),
            ) +
            '</span></div><button type="button">Load messages</button>';
          row.querySelector('button').addEventListener('click', () => {
            void loadMessages(state.taskId, attempt.attemptN, row);
          });
          attempts.append(row);
        }
      }

      async function loadTasks(options = {}) {
        const append = options.append === true;
        if (!state.teamId) {
          queue.innerHTML = '<div class="muted">Select a team first.</div>';
          loadMore.hidden = true;
          return;
        }
        if (append) {
          loadMore.disabled = true;
          loadMore.textContent = 'Loading...';
        } else {
          queue.innerHTML = '<div class="muted">Loading tasks...</div>';
          loadMore.hidden = true;
        }
        const result = await app.callServerTool({
          name: 'tasks_list',
          arguments: {
            team_id: state.teamId,
            status: state.status || undefined,
            limit: 25,
            cursor: append ? state.nextCursor : undefined,
          },
        });
        const data = parseToolJson(result);
        state.tasks = append
          ? state.tasks.concat(data.items ?? [])
          : data.items ?? [];
        state.nextCursor = data.nextCursor;
        await loadVisibleAttempts();
        renderAgents();
        renderQueue();
        loadMore.disabled = false;
        loadMore.textContent = 'Load more';
      }

      async function loadVisibleAttempts() {
        state.attemptsByTaskId = new Map();
        await Promise.all(
          state.tasks.map(async (task) => {
            try {
              const result = await app.callServerTool({
                name: 'tasks_attempts_list',
                arguments: { task_id: task.id },
              });
              state.attemptsByTaskId.set(
                task.id,
                parseToolJson(result).items ?? [],
              );
            } catch {
              state.attemptsByTaskId.set(task.id, []);
            }
          }),
        );
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
        const items = parseToolJson(result).items ?? [];
        state.attemptsByTaskId.set(taskId, items);
        renderAttempts(items);
        renderAgents();
        renderQueue();
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

      function applyOpenState(data) {
        state.teamId = data.team_id ?? data.teamId ?? '';
        state.taskId = data.task_id ?? data.taskId ?? '';
        state.status = data.status ?? '';
        state.consoleUrl = data.console_url ?? data.consoleUrl ?? '';
        syncTeamInputs();
        statusInput.value = state.status;
        connection.textContent = 'Connected';
        if (state.teamId) {
          void loadMembers(state.teamId);
        }
        if (state.taskId) {
          void loadTask(state.taskId);
        } else if (state.teamId) {
          void loadTasks();
        }
      }

      function renderTeams() {
        teamSelect.innerHTML = '<option value="">Select team</option>';
        for (const team of state.teams) {
          const option = document.createElement('option');
          option.value = team.id;
          option.textContent = getTeamLabel(team);
          teamSelect.append(option);
        }
        syncTeamInputs();
      }

      function renderAgents() {
        const counts = getWorkerTaskCounts();
        const options = new Map();
        for (const member of state.members.filter((item) => item.subjectType === 'agent')) {
          options.set(member.subjectId, getMemberLabel(member));
        }
        for (const agentId of counts.keys()) {
          if (!options.has(agentId)) {
            options.set(agentId, agentId);
          }
        }
        agentInput.innerHTML = '<option value="">Any agent</option>';
        for (const [agentId, label] of options) {
          const count = counts.get(agentId) ?? 0;
          const option = document.createElement('option');
          option.value = agentId;
          option.textContent = count > 0 ? label + ' (' + count + ')' : label;
          agentInput.append(option);
        }
        agentInput.value = state.agentId;
      }

      function syncTeamInputs() {
        teamIdInput.value = state.teamId;
        teamSelect.value = state.teams.some((team) => team.id === state.teamId)
          ? state.teamId
          : '';
      }

      async function loadTeams() {
        try {
          const result = await app.callServerTool({
            name: 'teams_list',
            arguments: {},
          });
          state.teams = parseToolJson(result).items ?? [];
          if (!state.teamId && state.teams.length > 0) {
            state.teamId = state.teams[0].id;
          }
          renderTeams();
          if (state.teamId) {
            await loadMembers(state.teamId);
            await loadTasks();
          }
        } catch (error) {
          connection.textContent =
            'Connected. Team suggestions unavailable: ' +
            (error.message ?? String(error));
        }
      }

      async function loadMembers(teamId) {
        state.members = [];
        state.agentId = '';
        renderAgents();
        if (!teamId) return;
        try {
          const result = await app.callServerTool({
            name: 'team_members_list',
            arguments: { team_id: teamId },
          });
          state.members = parseToolJson(result).members ?? [];
        } catch {
          state.members = [];
        }
        renderAgents();
      }

      app.ontoolinput = (params) => {
        applyOpenState(params.arguments ?? {});
      };
      app.ontoolresult = (result) => {
        applyOpenState(parseToolJson(result));
      };
      app.onerror = (error) => {
        connection.textContent = error.message ?? String(error);
      };

      byId('filters').addEventListener('submit', (event) => {
        event.preventDefault();
        state.teamId = teamIdInput.value.trim();
        state.agentId = agentInput.value;
        state.status = statusInput.value;
        void loadTasks();
      });
      teamSelect.addEventListener('change', () => {
        state.teamId = teamSelect.value;
        state.agentId = '';
        syncTeamInputs();
        void loadMembers(state.teamId).then(() => loadTasks());
      });
      teamIdInput.addEventListener('change', () => {
        state.teamId = teamIdInput.value.trim();
        state.agentId = '';
        syncTeamInputs();
        void loadMembers(state.teamId);
      });
      agentInput.addEventListener('change', () => {
        state.agentId = agentInput.value;
        renderQueue();
      });
      loadMore.addEventListener('click', () => {
        void loadTasks({ append: true });
      });
      openConsole.addEventListener('click', () => {
        if (state.consoleUrl) app.openLink({ url: state.consoleUrl });
      });

      app.connect().then(() => {
        if (connection.textContent === 'Connecting to host...') {
          connection.textContent = 'Connected';
        }
        return loadTeams();
      }).catch((error) => {
        connection.textContent = error.message ?? String(error);
      });
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
      'teams_list',
      'team_members_list',
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
