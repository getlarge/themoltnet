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
      details {
        margin-top: 10px;
        border-top: 1px solid var(--molt-border);
        padding-top: 10px;
      }
      summary {
        cursor: pointer;
        color: var(--molt-text-secondary);
        font-size: 12px;
      }
      .advanced-fields {
        display: grid;
        gap: 8px;
        grid-template-columns: minmax(0, 1fr);
        margin-top: 10px;
      }
      @media (min-width: 720px) {
        .advanced-fields {
          grid-template-columns: repeat(3, minmax(0, 1fr));
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
              <option value="dispatched">Dispatched</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
          </label>
        </div>
        <details id="advanced-filters">
          <summary>More filters</summary>
          <div class="advanced-fields">
            <label>
              Task type
              <input id="task-type" autocomplete="off" placeholder="curate_pack" />
            </label>
            <label>
              Diary ID
              <input id="diary-id" autocomplete="off" placeholder="diary uuid" />
            </label>
            <label>
              Correlation ID
              <input id="correlation-id" autocomplete="off" placeholder="correlation uuid" />
            </label>
            <label>
              Requested by agent
              <input id="requested-agent-id" autocomplete="off" placeholder="agent uuid" />
            </label>
            <label>
              Requested by human
              <input id="requested-human-id" autocomplete="off" placeholder="human uuid" />
            </label>
            <label>
              Attempts
              <select id="has-attempts">
                <option value="">Any</option>
                <option value="true">Has attempts</option>
                <option value="false">No attempts</option>
              </select>
            </label>
            <label>
              Queued after
              <input id="queued-after" type="datetime-local" />
            </label>
            <label>
              Queued before
              <input id="queued-before" type="datetime-local" />
            </label>
            <label>
              Completed after
              <input id="completed-after" type="datetime-local" />
            </label>
            <label>
              Completed before
              <input id="completed-before" type="datetime-local" />
            </label>
          </div>
        </details>
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
        taskType: '',
        diaryId: '',
        correlationId: '',
        requestedAgentId: '',
        requestedHumanId: '',
        hasAttempts: '',
        queuedAfter: '',
        queuedBefore: '',
        completedAfter: '',
        completedBefore: '',
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
      const taskTypeInput = byId('task-type');
      const diaryIdInput = byId('diary-id');
      const correlationIdInput = byId('correlation-id');
      const requestedAgentIdInput = byId('requested-agent-id');
      const requestedHumanIdInput = byId('requested-human-id');
      const hasAttemptsInput = byId('has-attempts');
      const queuedAfterInput = byId('queued-after');
      const queuedBeforeInput = byId('queued-before');
      const completedAfterInput = byId('completed-after');
      const completedBeforeInput = byId('completed-before');
      const advancedFilters = byId('advanced-filters');
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

      function optionalValue(value) {
        const text = String(value ?? '').trim();
        return text || undefined;
      }

      function optionalBoolean(value) {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return undefined;
      }

      function optionalDateTime(value) {
        if (!value) return undefined;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
      }

      function toDateTimeLocal(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const offsetMs = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
      }

      function readFiltersFromInputs() {
        state.teamId = optionalValue(teamIdInput.value) ?? '';
        state.agentId = agentInput.value;
        state.status = statusInput.value;
        state.taskType = taskTypeInput.value.trim();
        state.diaryId = diaryIdInput.value.trim();
        state.correlationId = correlationIdInput.value.trim();
        state.requestedAgentId = requestedAgentIdInput.value.trim();
        state.requestedHumanId = requestedHumanIdInput.value.trim();
        state.hasAttempts = hasAttemptsInput.value;
        state.queuedAfter = queuedAfterInput.value;
        state.queuedBefore = queuedBeforeInput.value;
        state.completedAfter = completedAfterInput.value;
        state.completedBefore = completedBeforeInput.value;
      }

      function hasAdvancedFilters() {
        return Boolean(
          state.taskType ||
            state.diaryId ||
            state.correlationId ||
            state.requestedAgentId ||
            state.requestedHumanId ||
            state.hasAttempts ||
            state.queuedAfter ||
            state.queuedBefore ||
            state.completedAfter ||
            state.completedBefore,
        );
      }

      function syncFilterInputs() {
        syncTeamInputs();
        agentInput.value = state.agentId;
        statusInput.value = state.status;
        taskTypeInput.value = state.taskType;
        diaryIdInput.value = state.diaryId;
        correlationIdInput.value = state.correlationId;
        requestedAgentIdInput.value = state.requestedAgentId;
        requestedHumanIdInput.value = state.requestedHumanId;
        hasAttemptsInput.value = state.hasAttempts;
        queuedAfterInput.value = state.queuedAfter;
        queuedBeforeInput.value = state.queuedBefore;
        completedAfterInput.value = state.completedAfter;
        completedBeforeInput.value = state.completedBefore;
        advancedFilters.open = hasAdvancedFilters();
      }

      function buildTaskListArguments(append) {
        return {
          team_id: state.teamId,
          status: optionalValue(state.status),
          task_type: optionalValue(state.taskType),
          correlation_id: optionalValue(state.correlationId),
          diary_id: optionalValue(state.diaryId),
          imposed_by_agent_id: optionalValue(state.requestedAgentId),
          imposed_by_human_id: optionalValue(state.requestedHumanId),
          claimed_by_agent_id: optionalValue(state.agentId),
          has_attempts: optionalBoolean(state.hasAttempts),
          queued_after: optionalDateTime(state.queuedAfter),
          queued_before: optionalDateTime(state.queuedBefore),
          completed_after: optionalDateTime(state.completedAfter),
          completed_before: optionalDateTime(state.completedBefore),
          limit: 25,
          cursor: append ? state.nextCursor : undefined,
        };
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
        loadMore.hidden = !state.nextCursor;
        queue.innerHTML = '';
        for (const task of state.tasks) {
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
          arguments: buildTaskListArguments(append),
        });
        const data = parseToolJson(result);
        state.tasks = append
          ? state.tasks.concat(data.items ?? [])
          : data.items ?? [];
        state.nextCursor = data.nextCursor;
        renderAgents();
        renderQueue();
        loadMore.disabled = false;
        loadMore.textContent = 'Load more';
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
        state.taskType = data.task_type ?? data.filters?.task_type ?? '';
        state.diaryId = data.diary_id ?? data.filters?.diary_id ?? '';
        state.correlationId =
          data.correlation_id ?? data.filters?.correlation_id ?? '';
        state.requestedAgentId =
          data.imposed_by_agent_id ?? data.filters?.imposed_by_agent_id ?? '';
        state.requestedHumanId =
          data.imposed_by_human_id ?? data.filters?.imposed_by_human_id ?? '';
        state.agentId =
          data.claimed_by_agent_id ?? data.filters?.claimed_by_agent_id ?? '';
        state.hasAttempts =
          typeof data.has_attempts === 'boolean'
            ? String(data.has_attempts)
            : typeof data.filters?.has_attempts === 'boolean'
              ? String(data.filters.has_attempts)
              : '';
        state.queuedAfter = toDateTimeLocal(
          data.queued_after ?? data.filters?.queued_after,
        );
        state.queuedBefore = toDateTimeLocal(
          data.queued_before ?? data.filters?.queued_before,
        );
        state.completedAfter = toDateTimeLocal(
          data.completed_after ?? data.filters?.completed_after,
        );
        state.completedBefore = toDateTimeLocal(
          data.completed_before ?? data.filters?.completed_before,
        );
        state.consoleUrl = data.console_url ?? data.consoleUrl ?? '';
        syncFilterInputs();
        connection.textContent = 'Connected';
        if (state.teamId) {
          void loadMembers(state.teamId, { preserveAgent: true });
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
        if (state.agentId && !options.has(state.agentId)) {
          options.set(state.agentId, state.agentId);
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

      async function loadMembers(teamId, options = {}) {
        state.members = [];
        if (options.preserveAgent !== true) {
          state.agentId = '';
        }
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
        readFiltersFromInputs();
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
        void loadMembers(state.teamId).then(() => loadTasks());
      });
      agentInput.addEventListener('change', () => {
        state.agentId = agentInput.value;
        void loadTasks();
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

function definedEntries<T extends Record<string, unknown>>(
  value: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

export function handleTasksAppOpen(
  args: TaskAppOpenInput,
  deps: Pick<McpDeps, 'consoleBaseUrl'> = {},
): CallToolResult {
  const filters = definedEntries({
    team_id: args.team_id,
    status: args.status,
    task_type: args.task_type,
    correlation_id: args.correlation_id,
    diary_id: args.diary_id,
    imposed_by_agent_id: args.imposed_by_agent_id,
    imposed_by_human_id: args.imposed_by_human_id,
    claimed_by_agent_id: args.claimed_by_agent_id,
    has_attempts: args.has_attempts,
    queued_after: args.queued_after,
    queued_before: args.queued_before,
    completed_after: args.completed_after,
    completed_before: args.completed_before,
  });
  const output: TaskAppOpenOutput = {
    app: 'moltnet_tasks',
    resourceUri: TASK_APP_RESOURCE_URI,
    teamId: args.team_id,
    taskId: args.task_id,
    status: args.status,
    filters,
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
