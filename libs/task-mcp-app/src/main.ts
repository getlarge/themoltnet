import './styles.css';

import { App } from '@modelcontextprotocol/ext-apps';
import { colors, fontFamily, radius } from '@themoltnet/design-system/tokens';

import { syncHostContext } from './host-context.js';
import { TASK_MCP_APP_TITLE } from './metadata.js';

const app = new App(
  { name: TASK_MCP_APP_TITLE, version: '0.1.0' },
  {},
  { autoResize: true },
);

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
  teams: [] as Array<{
    id: string;
    name?: string;
    personal?: boolean;
    role?: string;
  }>,
  members: [] as Array<{
    subjectId: string;
    subjectType?: string;
    displayName?: string;
    fingerprint?: string;
  }>,
  tasks: [] as Array<Record<string, unknown>>,
  nextCursor: undefined as string | undefined,
};

function applyThemeTokens(): void {
  const root = document.documentElement;
  const variables = {
    '--molt-bg-void': colors.bg.void,
    '--molt-bg-surface': colors.bg.surface,
    '--molt-bg-elevated': colors.bg.elevated,
    '--molt-bg-overlay': colors.bg.overlay,
    '--molt-primary': colors.primary.DEFAULT,
    '--molt-primary-hover': colors.primary.hover,
    '--molt-primary-muted': colors.primary.muted,
    '--molt-primary-subtle': colors.primary.subtle,
    '--molt-text': colors.text.DEFAULT,
    '--molt-text-secondary': colors.text.secondary,
    '--molt-text-inverse': colors.text.inverse,
    '--molt-border': colors.border.DEFAULT,
    '--molt-border-hover': colors.border.hover,
    '--molt-font-sans': fontFamily.sans,
    '--molt-font-mono': fontFamily.mono,
    '--molt-radius-sm': radius.sm,
    '--molt-radius-md': radius.md,
    '--molt-radius-full': radius.full,
  };

  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
}

const byId = (id: string) => document.getElementById(id);
const connection = byId('connection');
const teamSelect = byId('team-select') as HTMLSelectElement | null;
const teamIdInput = byId('team-id') as HTMLInputElement | null;
const agentInput = byId('agent') as HTMLSelectElement | null;
const statusInput = byId('status') as HTMLSelectElement | null;
const taskTypeInput = byId('task-type') as HTMLInputElement | null;
const diaryIdInput = byId('diary-id') as HTMLInputElement | null;
const correlationIdInput = byId('correlation-id') as HTMLInputElement | null;
const requestedAgentIdInput = byId(
  'requested-agent-id',
) as HTMLInputElement | null;
const requestedHumanIdInput = byId(
  'requested-human-id',
) as HTMLInputElement | null;
const hasAttemptsInput = byId('has-attempts') as HTMLSelectElement | null;
const queuedAfterInput = byId('queued-after') as HTMLInputElement | null;
const queuedBeforeInput = byId('queued-before') as HTMLInputElement | null;
const completedAfterInput = byId('completed-after') as HTMLInputElement | null;
const completedBeforeInput = byId(
  'completed-before',
) as HTMLInputElement | null;
const advancedFilters = byId('advanced-filters') as HTMLDetailsElement | null;
const queue = byId('queue');
const queueCount = byId('queue-count');
const loadMore = byId('load-more') as HTMLButtonElement | null;
const selectedStatus = byId('selected-status');
const taskDetail = byId('task-detail');
const attempts = byId('attempts');
const openConsole = byId('open-console') as HTMLButtonElement | null;

function parseToolJson(result: Record<string, unknown> | undefined) {
  const text = Array.isArray(result?.content)
    ? (
        result.content.find(
          (item): item is { type: string; text?: string } =>
            typeof item === 'object' &&
            item !== null &&
            'type' in item &&
            (item as { type?: string }).type === 'text',
        ) as { text?: string } | undefined
      )?.text
    : undefined;
  if (!text) return result?.structuredContent ?? {};
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return result?.structuredContent ?? {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function pretty(value: unknown) {
  return JSON.stringify(value ?? null, null, 2);
}

function optionalValue(value: string | undefined) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}

function optionalBoolean(value: string | undefined) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function optionalDateTime(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toDateTimeLocal(value: unknown) {
  const text = stringValue(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function readFiltersFromInputs() {
  state.teamId = optionalValue(teamIdInput?.value) ?? '';
  state.agentId = agentInput?.value ?? '';
  state.status = statusInput?.value ?? '';
  state.taskType = taskTypeInput?.value.trim() ?? '';
  state.diaryId = diaryIdInput?.value.trim() ?? '';
  state.correlationId = correlationIdInput?.value.trim() ?? '';
  state.requestedAgentId = requestedAgentIdInput?.value.trim() ?? '';
  state.requestedHumanId = requestedHumanIdInput?.value.trim() ?? '';
  state.hasAttempts = hasAttemptsInput?.value ?? '';
  state.queuedAfter = queuedAfterInput?.value ?? '';
  state.queuedBefore = queuedBeforeInput?.value ?? '';
  state.completedAfter = completedAfterInput?.value ?? '';
  state.completedBefore = completedBeforeInput?.value ?? '';
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
  if (agentInput) agentInput.value = state.agentId;
  if (statusInput) statusInput.value = state.status;
  if (taskTypeInput) taskTypeInput.value = state.taskType;
  if (diaryIdInput) diaryIdInput.value = state.diaryId;
  if (correlationIdInput) correlationIdInput.value = state.correlationId;
  if (requestedAgentIdInput)
    requestedAgentIdInput.value = state.requestedAgentId;
  if (requestedHumanIdInput)
    requestedHumanIdInput.value = state.requestedHumanId;
  if (hasAttemptsInput) hasAttemptsInput.value = state.hasAttempts;
  if (queuedAfterInput) queuedAfterInput.value = state.queuedAfter;
  if (queuedBeforeInput) queuedBeforeInput.value = state.queuedBefore;
  if (completedAfterInput) completedAfterInput.value = state.completedAfter;
  if (completedBeforeInput) completedBeforeInput.value = state.completedBefore;
  if (advancedFilters) advancedFilters.open = hasAdvancedFilters();
}

function buildTaskListArguments(append: boolean) {
  return {
    team_id: state.teamId,
    status: optionalValue(state.status),
    task_type: optionalValue(state.taskType),
    correlation_id: optionalValue(state.correlationId),
    diary_id: optionalValue(state.diaryId),
    proposed_by_agent_id: optionalValue(state.requestedAgentId),
    proposed_by_human_id: optionalValue(state.requestedHumanId),
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

function getTeamLabel(team: {
  id: string;
  name?: string;
  personal?: boolean;
  role?: string;
}) {
  const suffix = team.personal ? ' personal' : team.role ? ` ${team.role}` : '';
  return `${team.name ?? team.id}${suffix}`;
}

function getMemberLabel(member: {
  subjectId: string;
  displayName?: string;
  fingerprint?: string;
}) {
  const name = member.displayName || member.subjectId;
  const fingerprint = member.fingerprint
    ? ` ${member.fingerprint.slice(0, 12)}`
    : '';
  return `${name}${fingerprint}`;
}

function escapeHtml(value: unknown) {
  return stringValue(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderQueue() {
  if (!queue || !queueCount || !loadMore) return;
  queueCount.textContent = state.tasks.length
    ? `${state.tasks.length} task${state.tasks.length === 1 ? '' : 's'}`
    : 'No tasks';
  loadMore.hidden = !state.nextCursor;
  queue.innerHTML = '';
  for (const task of state.tasks) {
    const requesterAgentId = stringValue(task.proposedByAgentId);
    const requesterHumanId = stringValue(task.proposedByHumanId);
    const acceptedAttemptN = stringValue(task.acceptedAttemptN);
    const correlationId = stringValue(task.correlationId);
    const requesterText = requesterAgentId
      ? `Requested by agent ${requesterAgentId}`
      : requesterHumanId
        ? `Requested by human ${requesterHumanId}`
        : 'Requester unknown';
    const attemptText = acceptedAttemptN
      ? `Accepted attempt ${acceptedAttemptN}`
      : 'No accepted attempt';
    const correlationText = correlationId
      ? `Correlation ${correlationId}`
      : 'No correlation ID';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'queue-item';
    row.innerHTML =
      '<div class="stack"><strong>' +
      escapeHtml(task.taskType) +
      '</strong><code class="muted mono">' +
      escapeHtml(task.id) +
      '</code><code class="muted mono">' +
      escapeHtml(correlationText) +
      '</code><span class="muted">' +
      escapeHtml(`${requesterText} · ${attemptText}`) +
      '</span></div><span class="status queue-status">' +
      escapeHtml(task.status ?? 'unknown') +
      '</span>';
    row.addEventListener('click', () => {
      void loadTask(String(task.id));
    });
    queue.append(row);
  }
}

function renderTask(task: Record<string, unknown>) {
  if (!selectedStatus || !taskDetail || !openConsole) return;
  if (!task?.id) {
    selectedStatus.hidden = true;
    taskDetail.className = 'muted';
    taskDetail.textContent = 'Select a task to inspect it.';
    openConsole.hidden = true;
    return;
  }
  state.taskId = stringValue(task.id);
  state.consoleUrl = typeof task.consoleUrl === 'string' ? task.consoleUrl : '';
  selectedStatus.hidden = false;
  selectedStatus.textContent = stringValue(task.status ?? 'unknown');
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
    '</span></div><div class="fact"><strong>Correlation ID</strong><span class="mono">' +
    escapeHtml(task.correlationId ?? '—') +
    '</span></div><div class="fact"><strong>Queued</strong><span>' +
    escapeHtml(task.queuedAt ?? 'unknown') +
    '</span></div><div class="fact"><strong>Requester</strong><span class="mono">' +
    escapeHtml(task.proposedByAgentId ?? task.proposedByHumanId ?? '—') +
    '</span></div><div class="fact"><strong>Accepted</strong><span>' +
    escapeHtml(task.acceptedAttemptN ?? '—') +
    '</span></div></div><pre>' +
    escapeHtml(pretty(task.input)) +
    '</pre>';
  openConsole.hidden = !state.consoleUrl;
}

function renderAttempts(items: Array<Record<string, unknown>>) {
  if (!attempts) return;
  if (!items.length) {
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
          ) ?? { subjectId: stringValue(attempt.claimedByAgentId) },
        ),
      ) +
      '</span></div><button type="button">Load messages</button>';
    row.querySelector('button')?.addEventListener('click', () => {
      void loadMessages(state.taskId, Number(attempt.attemptN), row);
    });
    attempts.append(row);
  }
}

async function loadTasks(options: { append?: boolean } = {}) {
  const append = options.append === true;
  if (!queue || !loadMore) return;
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
  const data = parseToolJson(result as Record<string, unknown>) as {
    items?: Array<Record<string, unknown>>;
    nextCursor?: string;
  };
  state.tasks = append
    ? state.tasks.concat(data.items ?? [])
    : (data.items ?? []);
  state.nextCursor = data.nextCursor;
  renderAgents();
  renderQueue();
  loadMore.disabled = false;
  loadMore.textContent = 'Load more';
}

async function loadTask(taskId: string) {
  if (!taskDetail) return;
  taskDetail.className = 'muted';
  taskDetail.textContent = 'Loading task...';
  const result = await app.callServerTool({
    name: 'tasks_get',
    arguments: { id: taskId },
  });
  const task = parseToolJson(result as Record<string, unknown>) as Record<
    string,
    unknown
  >;
  renderTask(task);
  await loadAttempts(taskId);
}

async function loadAttempts(taskId: string) {
  if (!attempts) return;
  attempts.className = 'muted';
  attempts.textContent = 'Loading attempts...';
  const result = await app.callServerTool({
    name: 'tasks_attempts_list',
    arguments: { task_id: taskId },
  });
  const items =
    (
      parseToolJson(result as Record<string, unknown>) as {
        items?: Array<Record<string, unknown>>;
      }
    ).items ?? [];
  renderAttempts(items);
  renderAgents();
}

async function loadMessages(taskId: string, attemptN: number, row: Element) {
  const result = await app.callServerTool({
    name: 'tasks_messages_list',
    arguments: { task_id: taskId, attempt_n: attemptN, limit: 50 },
  });
  const messages = document.createElement('pre');
  messages.textContent = pretty(
    (
      parseToolJson(result as Record<string, unknown>) as {
        items?: Array<Record<string, unknown>>;
      }
    ).items ?? [],
  );
  row.after(messages);
}

function applyOpenState(data: Record<string, unknown>) {
  const filters = asRecord(data.filters);

  state.teamId = stringValue(data.team_id ?? data.teamId);
  state.taskId = stringValue(data.task_id ?? data.taskId);
  state.status = stringValue(data.status);
  state.taskType = stringValue(data.task_type ?? filters.task_type);
  state.diaryId = stringValue(data.diary_id ?? filters.diary_id);
  state.correlationId = stringValue(
    data.correlation_id ?? filters.correlation_id,
  );
  state.requestedAgentId = stringValue(
    data.proposed_by_agent_id ?? filters.proposed_by_agent_id,
  );
  state.requestedHumanId = stringValue(
    data.proposed_by_human_id ?? filters.proposed_by_human_id,
  );
  state.agentId = stringValue(
    data.claimed_by_agent_id ?? filters.claimed_by_agent_id,
  );
  state.hasAttempts =
    typeof data.has_attempts === 'boolean'
      ? String(data.has_attempts)
      : typeof filters.has_attempts === 'boolean'
        ? String(filters.has_attempts)
        : '';
  state.queuedAfter = toDateTimeLocal(
    data.queued_after ?? filters.queued_after,
  );
  state.queuedBefore = toDateTimeLocal(
    data.queued_before ?? filters.queued_before,
  );
  state.completedAfter = toDateTimeLocal(
    data.completed_after ?? filters.completed_after,
  );
  state.completedBefore = toDateTimeLocal(
    data.completed_before ?? filters.completed_before,
  );
  state.consoleUrl = stringValue(data.console_url ?? data.consoleUrl);
  syncFilterInputs();
  if (connection) connection.textContent = 'Connected';
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
  if (!teamSelect) return;
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
  if (!agentInput) return;
  const options = new Map<string, string>();
  for (const member of state.members.filter(
    (item) => item.subjectType === 'agent',
  )) {
    options.set(member.subjectId, getMemberLabel(member));
  }
  if (state.agentId && !options.has(state.agentId)) {
    options.set(state.agentId, state.agentId);
  }
  agentInput.innerHTML = '<option value="">Any agent</option>';
  for (const [agentId, label] of options) {
    const option = document.createElement('option');
    option.value = agentId;
    option.textContent = label;
    agentInput.append(option);
  }
  agentInput.value = state.agentId;
}

function syncTeamInputs() {
  if (teamIdInput) teamIdInput.value = state.teamId;
  if (teamSelect) {
    teamSelect.value = state.teams.some((team) => team.id === state.teamId)
      ? state.teamId
      : '';
  }
}

async function loadTeams() {
  try {
    const result = await app.callServerTool({
      name: 'teams_list',
      arguments: {},
    });
    state.teams =
      (
        parseToolJson(result as Record<string, unknown>) as {
          items?: Array<{
            id: string;
            name?: string;
            personal?: boolean;
            role?: string;
          }>;
        }
      ).items ?? [];
    if (!state.teamId && state.teams.length > 0) {
      state.teamId = state.teams[0].id;
    }
    renderTeams();
    if (state.teamId) {
      await loadMembers(state.teamId);
      await loadTasks();
    }
  } catch (error) {
    if (connection) {
      connection.textContent =
        'Connected. Team suggestions unavailable: ' +
        (error instanceof Error ? error.message : String(error));
    }
  }
}

async function loadMembers(
  teamId: string,
  options: { preserveAgent?: boolean } = {},
) {
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
    state.members =
      (
        parseToolJson(result as Record<string, unknown>) as {
          members?: Array<{
            subjectId: string;
            subjectType?: string;
            displayName?: string;
            fingerprint?: string;
          }>;
        }
      ).members ?? [];
  } catch {
    state.members = [];
  }
  renderAgents();
}

applyThemeTokens();
syncHostContext(app);

app.ontoolinput = (params) => {
  applyOpenState(
    (params as { arguments?: Record<string, unknown> }).arguments ?? {},
  );
};
app.ontoolresult = (result) => {
  applyOpenState(
    parseToolJson(result as Record<string, unknown>) as Record<string, unknown>,
  );
};

byId('filters')?.addEventListener('submit', (event) => {
  event.preventDefault();
  readFiltersFromInputs();
  void loadTasks();
});
teamSelect?.addEventListener('change', () => {
  state.teamId = teamSelect.value;
  state.agentId = '';
  syncTeamInputs();
  void loadMembers(state.teamId).then(() => loadTasks());
});
teamIdInput?.addEventListener('change', () => {
  state.teamId = teamIdInput.value.trim();
  state.agentId = '';
  syncTeamInputs();
  void loadMembers(state.teamId).then(() => loadTasks());
});
agentInput?.addEventListener('change', () => {
  state.agentId = agentInput.value;
  void loadTasks();
});
loadMore?.addEventListener('click', () => {
  void loadTasks({ append: true });
});
openConsole?.addEventListener('click', () => {
  if (state.consoleUrl) void app.openLink({ url: state.consoleUrl });
});

app
  .connect()
  .then(() => {
    if (connection?.textContent === 'Connecting to host...') {
      connection.textContent = 'Connected';
    }
    return loadTeams();
  })
  .catch((error: unknown) => {
    if (connection) {
      connection.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });
